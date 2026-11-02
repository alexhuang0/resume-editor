# Design Document

## Overview

This feature adds optional Google sign-in and whole-library cloud sync to an app that has, until now, been entirely client-side with a single `localStorage` persistence layer. The design is deliberately additive: every path that exists today keeps working untouched, and the new code sits in a layer that is dormant unless (a) the Supabase env vars are present and (b) a user is signed in.

Three new seams:

- **Config + client (`src/sync/supabase.ts`).** Reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` once at module load, validates them, and either exports a constructed Supabase client or `null`. `null` is Local_Only_Mode: no client is ever constructed, so no network call can happen (Req 8.4).
- **Auth (`src/sync/useAuth.ts` + `src/sync/authStore.ts`).** Owns session state, sign-in, sign-out, startup restore, and the subscription to Supabase `onAuthStateChange`. Exposes a small reactive surface the UI reads.
- **Sync engine (`src/sync/syncEngine.ts` pure core + `src/sync/syncController.ts` I/O shell).** The pure core builds payloads, merges libraries, evaluates the cloud-newer condition, and handles payload versions — all with no network and no DOM (Req 12.1). The shell wires the core to the Supabase client, the resume store, the toast queue, and the Conflict_Prompt.

The storage model is one row per user, the whole library in one JSONB column, resolved last-write-wins by a single upsert keyed on the user id, with a database-maintained `updated_at`. Per-row relational tables were rejected in clarify.

Language: TypeScript / React. Tests: Vitest + fast-check, already in the repo. The Supabase client is faked at the `src/sync/supabase.ts` boundary in tests; the pure core needs no fake at all.

## Architecture

```
                        VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
                                      │
                                      ▼
                        src/sync/supabase.ts  ── absent/invalid ──►  export null  (Local_Only_Mode)
                                      │ present + valid
                                      ▼
                             SupabaseClient
                     ┌────────────────┴─────────────────┐
                     ▼                                   ▼
          src/sync/useAuth.ts                  src/sync/syncController.ts  (I/O shell)
          session · signIn · signOut           read row · upsert row · debounce · retry
          onAuthStateChange subscription                   │
                     │                                     │ delegates all decisions to
                     │ session                             ▼
                     │                        src/sync/syncEngine.ts  (pure core)
                     │                        buildPayload · mergeLibraries
                     │                        isCloudNewer · reconcilePayloadVersion
                     ▼                                     │
            ┌─────────────────────────────────────────────┴───────────┐
            ▼                        ▼                     ▼            ▼
   src/store/resumeStore   src/store/migrations    src/store/schema   uiStore toasts
   (replaceLibrary,        (migratePersisted        (LibrarySchema-   + Conflict_Prompt
    partialize slice)       Library — reused)        derived payload   modal
                                                      validation)
```

The resume store is never imported by the pure core. The core is a set of functions over plain data; the controller is the only module that touches both the store and the network.

### Why a separate `src/sync/` directory

Everything new lives under `src/sync/` so the feature is one grep away and the store stays unaware of it. The store exposes exactly two things the sync layer needs and both already exist: the `partialize` slice shape (read) and `replaceLibrary(variants, bank)` (write). No store signature changes, which keeps Req 1.4 / 1.5 safe by construction.

## Components and Interfaces

### 1. Config and client — `src/sync/supabase.ts`

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function readConfig(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;                 // Req 8.1
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; } // Req 8.2
  if (parsed.protocol !== "https:") return null;        // Req 8.2
  return { url, anonKey };
}

const config = readConfig();

/** null ⇒ Local_Only_Mode. No client is constructed, so no request can fire (Req 8.4). */
export const supabase: SupabaseClient | null = config
  ? createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export const isSyncConfigured = supabase !== null;
```

`persistSession` + `autoRefreshToken` are what satisfy session-survives-reload (Req 3.1–3.3) without us writing token storage; `detectSessionInUrl` completes the OAuth redirect. The exported `isSyncConfigured` is the single source of truth the UI reads to decide whether to show a sign-in control at all (Req 2.1) or the unconfigured indication (Req 8.3).

### 2. Auth — `src/sync/authStore.ts` and `src/sync/useAuth.ts`

A tiny zustand store (no persist — Supabase owns the session) holds the reactive auth state:

```ts
type AuthStatus = "resolving" | "signed_out" | "signed_in";
type AuthState = {
  status: AuthStatus;      // starts "resolving" so the UI can render local content meanwhile (Req 3.6, 1.6)
  userId: string | null;
  email: string | null;
};
```

`useAuth()` wires it to Supabase once, on first mount:

- On init, if `supabase` is `null`, immediately set `status: "signed_out"` and do nothing else — Local_Only_Mode never subscribes (Req 8.4).
- Otherwise call `supabase.auth.getSession()` to restore a stored session (Req 3.1), then subscribe via `supabase.auth.onAuthStateChange((event, session) => …)`. The handler maps `SIGNED_IN` / `TOKEN_REFRESHED` → `signed_in`, `SIGNED_OUT` → `signed_out`, and a failed restore → `signed_out` (Req 3.4). The subscription is the single writer of auth state, so refresh (Req 3.2, 3.3) flows through the same path with no extra code.
- `signInWithGoogle()` → `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })`. Google is the only provider offered (Req 2.3). An error resolves to a toast and we stay signed out (Req 2.9).
- `signOut()` → `supabase.auth.signOut()`. The resume store is never touched, so Local_Library survives (Req 2.8, 2.7).

The app renders the editor regardless of `status`; `resolving` never blocks the first paint (Req 1.6, 3.6).

### 3. Sync engine — pure core `src/sync/syncEngine.ts`

The payload type is its own shape, **not** `Library`. `Library` (schema.ts) has `schemaVersion` + `variants` + `bank` and no `currentVariantId`; the persisted slice has `variants` + `currentVariantId` + `bank` and no version. The cloud payload is the persisted slice plus an explicit version stamp:

```ts
import { z } from "zod";
import { ResumeSchema, BankItemSchema } from "../store/schema";

export const PAYLOAD_VERSION = 3 as const; // MUST track resumeStore persist `version`

export const LibraryPayloadSchema = z.object({
  variants: z.array(ResumeSchema),
  currentVariantId: z.string(),
  bank: z.array(BankItemSchema).default([]),
  payloadVersion: z.number().int(),
});
export type LibraryPayload = z.infer<typeof LibraryPayloadSchema>;

type Slice = { variants: Resume[]; currentVariantId: string; bank: BankItem[] };
```

Four pure functions, each independently testable (Req 12.1):

```ts
// Req 4.6, 12.2, 12.3: exactly these four keys, nothing from uiStore.
export function buildPayload(slice: Slice): LibraryPayload {
  return {
    variants: slice.variants,
    currentVariantId: slice.currentVariantId,
    bank: slice.bank,
    payloadVersion: PAYLOAD_VERSION,
  };
}

// Req 4.2–4.4, 12.4, 12.5: union by id; on an id in both, cloud (payload) wins.
export function mergeLibraries(cloud: LibraryPayload, local: Slice): Slice {
  const variants = unionById(cloud.variants, local.variants); // cloud entry kept on collision
  const bank = unionById(cloud.bank, local.bank);
  const currentVariantId = variants.some(v => v.id === cloud.currentVariantId)
    ? cloud.currentVariantId
    : (variants[0]?.id ?? local.currentVariantId);
  return { variants, currentVariantId, bank };
}

// Req 5.2, 12.8: strictly greater than marker ⇒ newer; equal ⇒ not newer.
export function isCloudNewer(rowUpdatedAt: string, lastSyncedMarker: string | null): boolean {
  if (lastSyncedMarker === null) return true;       // never synced this user ⇒ treat cloud as newer-ish → read path decides
  return Date.parse(rowUpdatedAt) > Date.parse(lastSyncedMarker);
}

// Req 6.2–6.5, 12.6, 12.7
export type ReconcileResult =
  | { kind: "ok"; payload: LibraryPayload }
  | { kind: "too_new" }       // payloadVersion > PAYLOAD_VERSION  (Req 6.4)
  | { kind: "invalid" };      // fails schema validation            (Req 6.5)
export function reconcilePayloadVersion(raw: unknown): ReconcileResult { … }
```

`reconcilePayloadVersion` reads `payloadVersion` from `raw`. If higher than `PAYLOAD_VERSION` → `too_new`. If lower → it feeds the slice portion through `migratePersistedLibrary(slice, payloadVersion)` (the existing pure migrator — Req 6.3, no duplicate migration logic) and then validates with `LibraryPayloadSchema`. If equal → validate directly. Any validation failure → `invalid` (Req 6.5).

`unionById` keeps insertion order with the cloud list first, so a collision deterministically resolves to the cloud entry and the result has no duplicate ids (Req 12.4).

### 4. Sync controller — I/O shell `src/sync/syncController.ts`

The shell owns all effects and all decisions-with-consequences; it holds no business rules the core could hold instead.

Table access (one row per user):

```ts
// read
const { data, error } = await supabase.from("libraries").select("payload, updated_at").eq("user_id", userId).maybeSingle();
// write (last-write-wins, single upsert keyed on user — Req 5.9)
const { data, error } = await supabase.from("libraries")
  .upsert({ user_id: userId, payload }, { onConflict: "user_id" })
  .select("updated_at").single();
```

`user_id` is never sent as a filter the client controls for writes beyond its own id — RLS (below) enforces isolation server-side; the client-side `.eq`/`user_id` is convenience, not the security boundary (Req 7).

**On entering signed-in** (`status` → `signed_in`), the controller runs the initial reconcile:
1. Read the row.
2. No row → `buildPayload(localSlice)` → upsert → set marker to returned `updated_at` (Req 4.1).
3. Row present → `reconcilePayloadVersion(row.payload)`:
   - `too_new` → toast "cloud needs a newer app", suppress all writes for the session, leave local untouched (Req 6.4).
   - `invalid` → toast "invalid cloud library", leave local untouched (Req 6.5).
   - `ok` → evaluate `isCloudNewer(row.updated_at, marker(userId))`:
     - not newer → `mergeLibraries(payload, localSlice)`; if the merge changed anything, `replaceLibrary` locally **and** upsert; set marker (Req 4.2, 5.1).
     - newer → open the **Conflict_Prompt** and defer every write until the user chooses (Req 5.3, 5.7).

**Conflict_Prompt choices** (Req 5.4–5.6), handled in the shell:
- *Keep local* → upsert `buildPayload(localSlice)`, set marker to returned `updated_at`.
- *Use cloud* → `replaceLibrary(payload.variants, payload.bank)` + set `currentVariantId`; set marker to the fetched row's `updated_at`.
- *Download backup* → `exportLibraryAsJsonFile(localSlice.variants, localSlice.bank)` (reuse — Req 5.6), then re-open the prompt (Req 5.6). Neither store nor row is modified while the prompt is open (Req 5.7).

**Steady-state writes** (Req 5.8): the controller subscribes to the resume store with a selector over the persisted slice. On a slice change, while signed in and no conflict pending, it schedules a **debounced** upsert (≈800 ms trailing). The payload is rebuilt from the *then-current* slice at fire time, not captured at schedule time, which is what makes retry correct (Req 9.4).

**Pending / failed writes** (Req 9.2–9.5):
- A write in flight or queued sets sync status `pending`; success sets `synced` and advances the marker; a network failure sets `failed`, leaves the marker unchanged, and keeps the dirty flag so the next slice change (or a manual retry) re-sends the current slice (Req 9.2–9.4).
- Reads failing with a network error → toast, stay signed in, keep serving local (Req 9.1).
- A request failing because the session is unauthorized (401/expired-and-unrefreshable) → sign out to Anonymous_State, toast asking to re-auth, local untouched (Req 9.6).

**Last_Synced_Marker** lives in `localStorage` under `resume-editor:sync-marker:<userId>`, namespaced per user so switching accounts can't cross-contaminate. It stores the last `updated_at` observed for that user. It is read/written only by the controller.

### 5. UI surface

- **Account control** — a small cluster in the existing top toolbar (`App.tsx`). Local_Only_Mode (`!isSyncConfigured`): a muted "Cloud sync not configured" indicator (Req 8.3), no sign-in button (Req 2.1). Configured + signed out: a "Sign in with Google" button (Req 2.1, 2.2). Signed in: the user's email (Req 2.5) + a sign-out button (Req 2.6) + the sync-status chip.
- **Sync-status chip** — `synced` / `pending` / `failed`, visible only while signed in (Req 9.5). `failed` is clickable to force a retry.
- **Conflict_Prompt** — a new modal `src/sync/ConflictPrompt.tsx`. It must be a real modal, not a toast: the toast queue auto-dismisses after 6 s and toasts carry only an optional `undo`, so they can't host three durable choices. The modal offers Keep local / Use cloud / Download backup and blocks sync writes while open.
- Everything else (sign-in failure, sync read failure, re-auth request, too-new/invalid cloud) reuses the existing `pushToast` queue (Req 2.9, 6.4, 6.5, 9.1, 9.6).

## Data Models

### Supabase table + RLS (paste-ready — belongs in the Setup_Guide, Req 10.4)

```sql
create table if not exists public.libraries (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  payload    jsonb not null,
  updated_at timestamptz not null default now()
);

-- updated_at maintained by the database on every write (Req 7.7)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists libraries_set_updated_at on public.libraries;
create trigger libraries_set_updated_at
  before insert or update on public.libraries
  for each row execute function public.set_updated_at();

alter table public.libraries enable row level security;   -- Req 7.6

create policy "own_select" on public.libraries
  for select using (auth.uid() = user_id);                -- Req 7.2, 7.4
create policy "own_insert" on public.libraries
  for insert with check (auth.uid() = user_id);           -- Req 7.3, 7.5
create policy "own_update" on public.libraries
  for update using (auth.uid() = user_id)
             with check (auth.uid() = user_id);            -- Req 7.3, 7.5
```

RLS enabled with policies only for the row-owner means an unauthenticated request (no `auth.uid()`) matches nothing and is rejected (Req 7.6), a cross-user select returns zero rows (Req 7.4), and a cross-user insert/update fails the `with check` (Req 7.5).

### Env and ignore

`.env.example` at repo root (Req 10.6):

```
# Copy to .env and fill in from your Supabase project settings → API.
# The anon key is safe to ship in the client bundle; the Google client
# secret is NOT here — it lives in Supabase Auth settings. (Req 10.8)
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

`.gitignore` today has only `*.local`, which matches `.env.local` but **not** `.env`. Add explicit lines (Req 10.7):

```
.env
.env.local
```

## Documentation

### Setup_Guide (Req 10)

A new `## Cloud sync setup` section in `README.md` (single file users already open; a sibling doc risks drifting out of sight). It covers, in order: create a Supabase project and find URL + anon key (10.1); create a Google Cloud OAuth 2.0 client and paste client id/secret into Supabase Auth → Providers → Google (10.2); register redirect URLs — the Supabase callback `https://<ref>.supabase.co/auth/v1/callback` in the Google client, plus `http://localhost:5173` and the deployed origin in Supabase Auth → URL config (10.3); run the SQL above (10.4); copy `.env.example` → `.env` and fill it (10.5); the note that the anon key is public-safe and the secret stays in Supabase (10.8).

### CLAUDE.md edits (Req 11)

- Remove "cloud sync, accounts, multi-device" from the out-of-scope list; keep version history, in-browser LaTeX, in-app AI tailoring, cover letters, multi-page layouts, themes excluded (11.1, 11.2).
- Add a sync paragraph to the architecture section: the Sync_Engine, one-row-per-user JSONB storage, last-write-wins, the Conflict_Prompt, and that UI_State stays out of the payload (11.3, 11.4).
- Note in the commands section that the `VITE_SUPABASE_*` vars enable sign-in and their absence yields Local_Only_Mode (11.5).

## Error Handling

| Condition | Handling | Req |
|---|---|---|
| Env vars missing/empty/invalid | `supabase = null`, Local_Only_Mode, editor renders | 8.1, 8.2 |
| OAuth authorization error | stay signed out, toast reason | 2.9 |
| Session restore/refresh fails | signed-out, show sign-in, keep local | 3.4, 3.5 |
| Cloud read network error | toast, stay signed in, serve local | 9.1 |
| Cloud write network error | marker unchanged, keep dirty, retry current slice later | 9.2–9.4 |
| Unauthorized request | sign out, re-auth toast, local untouched | 9.6 |
| Cloud payloadVersion too new | suppress writes for session, local untouched, toast | 6.4 |
| Cloud payload invalid schema | local untouched, toast | 6.5 |

## Testing Strategy

Mapped to Requirement 12. The pure core (`syncEngine.ts`) is tested with no fakes:

- `buildPayload` output has exactly `variants`, `currentVariantId`, `bank`, `payloadVersion` (12.2) and contains no uiStore key — assert absence of `collapsed`, `collapsedItems`, `paneOrder`, `minimizedPanes` (12.3).
- `mergeLibraries`: property-based (fast-check) — for arbitrary cloud/local variant id sets, result ids equal the union and carry no duplicates (12.4); a hand-built case asserts an id present on both sides resolves to the cloud entry (12.5).
- `reconcilePayloadVersion`: a payload at version 2 upgrades through `migratePersistedLibrary` to the current version (12.6); a payload above current leaves input unmodified → `too_new` (12.7).
- `isCloudNewer`: true when row ts > marker, false when equal (12.8).

The controller is tested against a hand-rolled fake of the `src/sync/supabase.ts` export (an object with `.from().select()/.upsert()` and an `auth` stub) injected at the module boundary, covering: no-row first-write, merge-on-login, the three conflict choices, the retry-sends-current-slice path, and the unauthorized→signout path.

Config resolution (12.9): with env vars unset, `isSyncConfigured === false` and `supabase === null`.

Gate: `npm test` green, `npm run build` clean, `npm run lint` no findings (12.10).

## Dependencies

Add `@supabase/supabase-js` (pinned, latest 2.x) to `dependencies`. No other runtime dependency. Dev/test stack unchanged (vitest + fast-check already present).

## Correctness Properties

These are invariants the pure core must hold for all inputs. They are the basis for the property-based tests 

**Validates: Requirements 12.4** and the example-based assertions around them.

### Property 1: Payload shape is closed

For any slice, `buildPayload(slice)` has exactly the keys `variants`, `currentVariantId`, `bank`, `payloadVersion` and no key that originates in `uiStore` (`collapsedSections`, `collapsedItems`, `paneOrder`, `minimizedPanes`, `paneWidths`, `previewZoom`, `pageFit`, `sidebarMode`, `focus`, `toasts`). 

**Validates: Requirements 4.6, 12.2, 12.3**

### Property 2: Merge is a union over ids

For any `cloud` and `local`, the id set of `mergeLibraries(cloud, local).variants` equals the union of the input variant id sets, and likewise for `bank`. 

**Validates: Requirements 4.2, 12.4**

### Property 3: Merge has no duplicates

`mergeLibraries(...).variants` contains no two entries with the same `id`; same for `bank`. 

**Validates: Requirements 12.4**

### Property 4: Collision resolves to cloud

If an `id` appears in both `cloud` and `local`, the merged entry is the one from `cloud`. 

**Validates: Requirements 4.3, 12.5**

### Property 5: currentVariantId stays valid

`mergeLibraries(...).currentVariantId` always identifies a variant present in the merged `variants` (the cloud value when it still resolves, otherwise the first merged variant). 

**Validates: Requirements 4.4**

### Property 6: Cloud-newer is a strict comparison

`isCloudNewer(ts, marker)` is `true` exactly when `ts` is strictly after `marker`, and `false` when they are equal. 

**Validates: Requirements 5.2, 12.8**

### Property 7: Version reconcile never mutates input

`reconcilePayloadVersion(raw)` returns `too_new` for a higher version and leaves `raw` unmodified; for a lower version it routes through `migratePersistedLibrary` and never applies migration logic of its own. 

**Validates: Requirements 6.2, 6.3, 6.4, 12.6, 12.7**
