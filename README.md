# resume-editor

Local web app for editing a Jake's-resume-style CV. Designed to round-trip a stable JSON artifact with Claude.ai for AI-assisted tailoring per job posting, then export to PDF (via browser print) and Markdown.

## Run it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. The app seeds a default variant on first run; everything persists to browser `localStorage`.

## Scripts

| | |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check + production bundle to `dist/` |
| `npm run lint` | Oxlint |
| `npm run preview` | Serve the built `dist/` |

## Where to look next

- **[ONBOARDING.md](./ONBOARDING.md)** — design rationale, invariants, and the verification ritual. Read this if you're returning to the repo after time away.
- **[CLAUDE.md](./CLAUDE.md)** — architecture map written for Claude Code agents; also useful as a deeper code tour.

## Stack

Vite + React 18 + TypeScript, with `zustand` (state, persisted to `localStorage`), `@dnd-kit` (drag-to-reorder), `zod` (JSON import validation), and `react-hotkeys-hook` (keyboard shortcuts). No PDF library — PDF export is `window.print()` against a shared screen + `@media print` stylesheet.

## Cloud sync setup

Cloud sync is optional. Without the two `VITE_SUPABASE_*` env vars the app runs exactly as before — everything stays in browser `localStorage` and no sign-in control appears (Local_Only_Mode). To enable optional Google sign-in and whole-library sync across devices, do the following, in order.

### 1. Create a Supabase project

1. Create a project at <https://supabase.com>.
2. Open **Project Settings → API** and copy two values:
   - **Project URL** (looks like `https://your-project-ref.supabase.co`) → this is `VITE_SUPABASE_URL`.
   - **anon / public key** → this is `VITE_SUPABASE_ANON_KEY`. The anon key is safe to ship in the client bundle.

### 2. Create a Google OAuth client

1. In the [Google Cloud Console](https://console.cloud.google.com/) create an **OAuth 2.0 Client ID** (type: Web application).
2. Copy the generated **Client ID** and **Client secret**.
3. In Supabase, open **Authentication → Providers → Google**, enable it, and paste the Client ID and Client secret there. The client secret lives only in Supabase — it never goes in this repo or the `.env` file.

### 3. Register redirect URLs

- In the **Google** OAuth client, add the Supabase callback as an authorized redirect URI:
  ```
  https://<your-project-ref>.supabase.co/auth/v1/callback
  ```
- In Supabase, open **Authentication → URL Configuration** and add your app origins (both the local dev origin and your deployed origin) to the allowed redirect URLs:
  ```
  http://localhost:5173
  https://your-deployed-origin.example.com
  ```

### 4. Create the table, trigger, and RLS policies

In Supabase open the **SQL Editor** and run the following. It creates the one-row-per-user `libraries` table, a trigger that maintains `updated_at` on every write, and row-level security so each user can only read and write their own row.

```sql
create table if not exists public.libraries (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  payload    jsonb not null,
  updated_at timestamptz not null default now()
);

-- updated_at maintained by the database on every write
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists libraries_set_updated_at on public.libraries;
create trigger libraries_set_updated_at
  before insert or update on public.libraries
  for each row execute function public.set_updated_at();

alter table public.libraries enable row level security;

create policy "own_select" on public.libraries
  for select using (auth.uid() = user_id);
create policy "own_insert" on public.libraries
  for insert with check (auth.uid() = user_id);
create policy "own_update" on public.libraries
  for update using (auth.uid() = user_id)
             with check (auth.uid() = user_id);
```

### 5. Configure the app environment

Copy the example env file and fill in the two values from step 1:

```bash
cp .env.example .env
```

Then edit `.env`:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Restart the dev server after changing `.env`. With both vars present and valid, a "Sign in with Google" control appears. The anon key is public-safe and belongs in the client; the Google client secret stays in Supabase Auth settings and never in this repo.
