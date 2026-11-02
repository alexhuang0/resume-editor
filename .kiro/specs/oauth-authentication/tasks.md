# Implementation Plan: oauth-authentication

## Overview

Optional Google sign-in plus whole-library cloud sync for a previously client-only React + TypeScript app, built in a new `src/sync/` layer that stays dormant unless the Supabase env vars are present and a user is signed in. The resume store is untouched except that the sync layer reads its persisted slice and calls the existing `replaceLibrary`.

Build order follows the dependency grain: config/client first (everything gates on it), then the pure sync-engine core (no network, no DOM, property-tested in isolation), then auth, then the I/O controller that wires core + client + store, then the UI surface, then docs and backend SQL, then a final green-bar checkpoint. Tests run with `npx vitest --run`.

The pure core (Task 2) is intentionally testable before any Supabase code exists, so the property tests in 2.2 pin the merge/version invariants before the controller depends on them.

## Tasks

- [x] 1. Add the Supabase dependency and the config/client module
  - [x] 1.1 Install and pin `@supabase/supabase-js`
    - Add `@supabase/supabase-js` (latest 2.x, pinned exact) to `dependencies` in `package.json` and install
    - Confirm `npm run build` still succeeds with the new dependency present
    - _Requirements: 2.2, 3.1_
  - [x] 1.2 Write `src/sync/supabase.ts` config resolution and client construction
    - Read `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `import.meta.env`, trimming whitespace
    - Return Local_Only_Mode (`supabase = null`) when either var is absent/empty, or when the URL does not parse as an absolute `https:` URL
    - When valid, construct the client with `auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }`
    - Export `supabase: SupabaseClient | null` and `isSyncConfigured: boolean`; construct no client in Local_Only_Mode
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6, 3.1, 3.2_
  - [x] 1.3 Test config resolution degrades to Local_Only_Mode
    - Create `src/sync/supabase.test.ts`; with env vars unset assert `isSyncConfigured === false` and `supabase === null`; with an invalid (non-https / unparseable) URL assert the same
    - _Requirements: 8.1, 8.2, 12.9_

- [x] 2. Build the pure sync-engine core
  - [x] 2.1 Write `src/sync/syncEngine.ts` pure functions and payload schema
    - Define `PAYLOAD_VERSION = 3`, `LibraryPayloadSchema` (zod, derived from `ResumeSchema`/`BankItemSchema` + `currentVariantId` + `payloadVersion`), and the `LibraryPayload` type
    - Implement `buildPayload(slice)` returning exactly `{ variants, currentVariantId, bank, payloadVersion }`
    - Implement `mergeLibraries(cloud, local)`: union variants and bank by `id` (cloud wins on collision, no duplicates), and resolve `currentVariantId` to the cloud value when it still identifies a merged variant else the first merged variant
    - Implement `isCloudNewer(rowUpdatedAt, lastSyncedMarker)`: strict `>` on parsed timestamps; `null` marker treated as newer
    - Implement `reconcilePayloadVersion(raw)`: `too_new` when above current (input unmodified); when below, route the slice through `migratePersistedLibrary` (no local migration logic) then validate; validate directly when equal; `invalid` on any schema failure
    - _Requirements: 4.2, 4.3, 4.4, 4.6, 5.2, 6.1, 6.2, 6.3, 6.4, 6.5, 12.1_
  - [x] 2.2 Write property tests for the sync-engine core
    - Create `src/sync/syncEngine.property.test.ts` with fast-check (≥100 iterations), tag format `Feature: oauth-authentication, Property {n}: ...`
    - **Property 1: Payload shape is closed** — `buildPayload` output has exactly `variants`, `currentVariantId`, `bank`, `payloadVersion` and no uiStore key (`collapsedSections`, `collapsedItems`, `paneOrder`, `minimizedPanes`, etc.)
    - **Property 2: Merge is a union over ids** — merged variant/bank id sets equal the union of input id sets
    - **Property 3: Merge has no duplicates** — merged variants and bank each have no repeated `id`
    - **Property 5: currentVariantId stays valid** — the merged `currentVariantId` always identifies a merged variant
    - **Property 6: Cloud-newer is a strict comparison** — true iff row timestamp is strictly after the marker; false on equality
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.6, 5.2, 12.2, 12.3, 12.4, 12.8**
  - [x] 2.3 Write example tests for the sync-engine core
    - Create `src/sync/syncEngine.test.ts`
    - **Property 4: Collision resolves to cloud** — an `id` present in both cloud and local merges to the cloud entry (12.5)
    - Payload keys/no-UI-state example asserting absence of `collapsed` specifically (12.3)
    - **Property 7: Version reconcile never mutates input** — a version-2 payload upgrades through `migratePersistedLibrary` to current (12.6); a payload above current returns `too_new` with input unmodified (12.7)
    - `isCloudNewer` equal-timestamps case returns false (12.8)
    - _Requirements: 4.3, 6.2, 6.3, 6.4, 6.5, 12.3, 12.5, 12.6, 12.7_

- [x] 3. Build the auth layer
  - [x] 3.1 Write `src/sync/authStore.ts` and `src/sync/useAuth.ts`
    - zustand store (no persist) with `status: "resolving" | "signed_out" | "signed_in"`, `userId`, `email`
    - `useAuth()`: in Local_Only_Mode set `signed_out` and never subscribe; otherwise `getSession()` to restore, then subscribe to `onAuthStateChange` as the single writer of auth state (maps SIGNED_IN/TOKEN_REFRESHED → signed_in, SIGNED_OUT/failed restore → signed_out)
    - `signInWithGoogle()` via `signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })`; on error stay signed out and push a toast
    - `signOut()` via `supabase.auth.signOut()` without touching the resume store
    - _Requirements: 2.2, 2.3, 2.4, 2.7, 2.8, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.4_

- [x] 4. Build the sync controller (I/O shell)
  - [x] 4.1 Write `src/sync/syncController.ts` row access and initial reconcile
    - Read via `.from("libraries").select("payload, updated_at").eq("user_id", userId).maybeSingle()`; write via `.upsert({ user_id, payload }, { onConflict: "user_id" }).select("updated_at").single()`
    - On entering signed-in: no row → upsert `buildPayload(localSlice)` + set marker; row → `reconcilePayloadVersion` (handle `too_new`/`invalid` with toasts and write suppression), then on `ok` evaluate `isCloudNewer` → merge-and-write when not newer, open Conflict_Prompt when newer
    - Store the Last_Synced_Marker in `localStorage` under `resume-editor:sync-marker:<userId>`, read/written only here
    - _Requirements: 4.1, 4.2, 4.5, 5.1, 5.3, 5.7, 5.9, 6.2, 6.4, 6.5_
  - [x] 4.2 Implement Conflict_Prompt resolution and steady-state debounced writes
    - Keep-local → upsert local payload + set marker; Use-cloud → `replaceLibrary(payload.variants, payload.bank)` + set `currentVariantId` + set marker to fetched `updated_at`; Download-backup → `exportLibraryAsJsonFile(...)` then re-open the prompt; leave store and row untouched while the prompt is open
    - Subscribe to the resume store's persisted slice; on change while signed-in with no pending conflict, schedule a debounced upsert that rebuilds the payload from the then-current slice at fire time
    - Track sync status (synced/pending/failed); on write network failure leave the marker unchanged and keep a dirty flag so the next write re-sends the current slice
    - _Requirements: 4.4, 5.4, 5.5, 5.6, 5.7, 5.8, 9.2, 9.3, 9.4, 9.5_
  - [x] 4.3 Handle read failures and unauthorized sessions
    - Cloud read network error → toast, stay signed in, keep serving local (9.1)
    - Unauthorized request → sign out to Anonymous_State, re-auth toast, local untouched (9.6)
    - _Requirements: 9.1, 9.6_
  - [x] 4.4 Write controller tests against a faked Supabase boundary
    - Create `src/sync/syncController.test.ts` with a hand-rolled fake of the `supabase.ts` export
    - Cover: no-row first write, merge-on-login writes both sides, each of the three conflict choices, retry sends the current slice after a failed write, and the unauthorized→signout path
    - _Requirements: 4.1, 4.2, 5.4, 5.5, 5.6, 9.2, 9.4, 9.6_

- [x] 5. Build the UI surface
  - [x] 5.1 Add the account control, email display, and sync-status chip to the toolbar
    - In `App.tsx`: Local_Only_Mode shows a muted "Cloud sync not configured" indicator and no sign-in button; configured+signed-out shows "Sign in with Google"; signed-in shows the user email, a sign-out button, and the synced/pending/failed chip (chip clickable to retry when failed)
    - _Requirements: 2.1, 2.5, 2.6, 8.3, 9.5_
  - [x] 5.2 Write the Conflict_Prompt modal
    - Create `src/sync/ConflictPrompt.tsx`: a real modal (not a toast) offering Keep local / Use cloud / Download backup, wired to the controller's resolution handlers and blocking writes while open
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7_
  - [x] 5.3 Mount auth and the sync controller at the app root
    - Call `useAuth()` and start/stop the controller tied to auth status; ensure the editor renders local content during `resolving` and in Local_Only_Mode before any auth request
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 3.6_

- [x] 6. Backend setup artifacts and documentation
  - [x] 6.1 Add `.env.example` and fix `.gitignore`
    - Create `.env.example` listing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with placeholder values and the anon-key-is-public / secret-stays-in-Supabase note; no real credentials
    - Add `.env` and `.env.local` lines to `.gitignore` (today only `*.local` exists, which misses plain `.env`)
    - _Requirements: 10.5, 10.6, 10.7, 10.8_
  - [x] 6.2 Write the Setup_Guide in README.md
    - Add a `## Cloud sync setup` section covering Supabase project + URL/anon key, Google Cloud OAuth client + pasting id/secret into Supabase, redirect URLs (Supabase callback in the Google client, localhost + deployed origin in Supabase), the paste-ready table + trigger + RLS SQL, and copying `.env.example` → `.env`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.8_
  - [x] 6.3 Update CLAUDE.md
    - Remove cloud sync / accounts / multi-device from the out-of-scope list while keeping version history, in-browser LaTeX, in-app AI tailoring, cover letters, multi-page layouts, and themes excluded
    - Add a sync paragraph to the architecture section (Sync_Engine, one-row-per-user JSONB, last-write-wins, Conflict_Prompt, UI_State excluded from the payload) and note the `VITE_SUPABASE_*` vars / Local_Only_Mode in the commands section
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 7. Checkpoint - full verification
  - Run `npx vitest --run`, `npm run build`, and `npm run lint`; ensure all pass with no findings. Ask the user if questions arise.
  - _Requirements: 12.10_

## Task Dependency Graph

```json
{
  "tasks": {
    "1.1": [],
    "1.2": ["1.1"],
    "1.3": ["1.2"],
    "2.1": [],
    "2.2": ["2.1"],
    "2.3": ["2.1"],
    "3.1": ["1.2"],
    "4.1": ["1.2", "2.1"],
    "4.2": ["4.1"],
    "4.3": ["4.1"],
    "4.4": ["4.2"],
    "5.1": ["4.2"],
    "5.2": ["4.2"],
    "5.3": ["3.1", "5.1", "5.2"],
    "6.1": [],
    "6.2": [],
    "6.3": [],
    "7": ["1.3", "2.2", "2.3", "3.1", "4.3", "4.4", "5.3", "6.1", "6.2", "6.3"]
  },
  "waves": [
    ["1.1", "2.1", "6.1", "6.2", "6.3"],
    ["1.2", "2.2", "2.3"],
    ["1.3", "3.1", "4.1"],
    ["4.2", "4.3"],
    ["4.4", "5.1", "5.2"],
    ["5.3"],
    ["7"]
  ]
}
```

```
1.1 ──► 1.2 ──► 1.3
         │
         ├────────────► 3.1 ──► 5.3
         │                        ▲
2.1 ──► 2.2                       │
  │  └► 2.3                       │
  └──────────────► 4.1 ──► 4.2 ──┤
                    │      │      │
                    4.3 ───┘      │
                    4.2 ──► 4.4   │
                    4.2 ──► 5.1   │
                    4.2 ──► 5.2 ──┘

6.1   (independent)
6.2   (independent)
6.3   (independent)

all leaf tasks ──► 7
```

- `1.1 → 1.2 → 1.3`: dependency install, then the client module, then its config test.
- `2.1 → 2.2`, `2.1 → 2.3`: the pure core, then its property and example tests. Task 2 depends only on existing store modules, so it can run in parallel with Task 1.
- `4.1` depends on both `1.2` (the client) and `2.1` (the core); `4.2` depends on `4.1`; `4.3` depends on `4.1`; `4.4` depends on `4.2`.
- `3.1` depends on `1.2`. `5.1`/`5.2` depend on `4.2`. `5.3` depends on `3.1` and `5.1`/`5.2`.
- `6.1`, `6.2`, `6.3` are documentation/backend artifacts with no code dependency and may run any time.
- `7` is the final checkpoint and depends on every leaf task.

## Notes

- **Do not change the resume store's persist config.** `name: "resume-editor:v1"`, `version: 3`, `migrate`, and the three-key `partialize` are pinned by Requirements 1.4/1.5 and by existing tests. The sync layer reads the slice and calls the existing `replaceLibrary`; it does not alter the store's signatures.
- **Reuse, don't duplicate.** Schema upgrades go through `migratePersistedLibrary` (migrations.ts); the backup download reuses `exportLibraryAsJsonFile` (importExport.ts); payload validation reuses the zod schemas in schema.ts; error reporting reuses the uiStore toast queue.
- **The Conflict_Prompt must be a modal, not a toast.** The toast queue auto-dismisses after 6 s and toasts carry only an optional `undo`, so they cannot host three durable choices.
- **The anon key is public-safe; no secret belongs in the repo.** Only `VITE_`-prefixed vars are read, and only from the environment (Req 8.5, 8.6).
- **The user provisions the backend.** Tasks 6.1/6.2 produce the instructions and `.env.example`; actually creating the Supabase project, the Google OAuth client, and running the SQL is the user's step, performed with the Setup_Guide.
- Run tests with `npx vitest --run` (single run, no watch).
