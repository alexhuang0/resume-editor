import { supabase } from "./supabase";
import {
  buildPayload,
  isCloudNewer,
  mergeLibraries,
  reconcilePayloadVersion,
  type LibraryPayload,
} from "./syncEngine";
import { useResumeStore } from "../store/resumeStore";
import { useUiStore } from "../store/uiStore";
import { exportLibraryAsJsonFile } from "../exporters/importExport";
import { signOut } from "./useAuth";
import type { BankItem, Resume } from "../store/schema";

/**
 * Sync controller — the I/O shell (design §"4. Sync controller — I/O shell").
 *
 * This module owns every effect and every decision-with-consequences in the
 * sync layer; the pure core (`syncEngine.ts`) holds the business rules. The
 * shell is the only place that touches both the resume store and the network.
 *
 * This file is built in three slices across tasks 4.1 → 4.3:
 *  - 4.1 (here): row access + the INITIAL reconcile on entering signed-in, plus
 *    the Last_Synced_Marker storage. Writes are expressed through one `writeRow`
 *    primitive and reads through one `readRow` primitive so the later slices
 *    reuse them.
 *  - 4.2 (here): Conflict_Prompt resolution + the debounced steady-state
 *    writes. The resolution handlers (`resolveConflictKeepLocal` /
 *    `resolveConflictUseCloud` / `resolveConflictDownloadBackup`) adopt one
 *    side of a pending conflict; the store subscription schedules a trailing
 *    debounced upsert that rebuilds the payload from the THEN-CURRENT slice at
 *    fire time (so a retry after a failed write re-sends current content —
 *    Req 9.4); and a sync-status surface (`synced`/`pending`/`failed` with a
 *    `subscribeSyncStatus`/`getSyncStatus` pair and a `retrySync` trigger)
 *    feeds task 5.1's status chip.
 *  - 4.3 (here): read-failure and unauthorized-session handling. The read/write
 *    primitives return a tagged error kind so this slice can branch on it
 *    without reshaping the call sites. A `network` error keeps the client
 *    signed in and serving local with a toast (Req 9.1); an `unauthorized`
 *    error drives the shared sign-out path (`supabase.auth.signOut()` via the
 *    auth `signOut`) and a re-auth toast, leaving the resume store untouched
 *    (Req 9.6). The sign-out triggers `onAuthStateChange → SIGNED_OUT`, which
 *    task 5.3 turns into a `stopController()` — so this slice only requests the
 *    sign-out; it does not tear the controller down itself.
 *
 * Nothing wires auth to the controller here: task 5.3 mounts `useAuth` and calls
 * `startController(userId)` / `stopController()` as the auth status flips.
 */

/** The persisted slice shape the sync layer reads and merges. */
type Slice = {
  variants: Resume[];
  currentVariantId: string;
  bank: BankItem[];
};

/**
 * A deferred Conflict_Prompt. When the cloud row is strictly newer than what
 * this client last synced, the initial reconcile defers to the user instead of
 * merging-and-writing. Task 4.2 resolves it (Keep local / Use cloud / Download
 * backup); task 5.2 renders it as a modal. Until then, "opening" the prompt is
 * just setting this state and every write stays deferred.
 */
export type PendingConflict = {
  /** The reconciled cloud payload the user may choose to adopt. */
  cloudPayload: LibraryPayload;
  /** The row's `updated_at`, i.e. the marker to set if the cloud side wins. */
  cloudUpdatedAt: string;
  /** The local slice captured when the conflict opened. */
  localSlice: Slice;
};

/**
 * The sync status surfaced to the toolbar chip (Req 9.5). `synced` = the cloud
 * holds this client's current slice; `pending` = a write is queued or in
 * flight; `failed` = the last write hit a network error and the slice is still
 * dirty (clickable to retry — task 5.1).
 */
export type SyncStatus = "synced" | "pending" | "failed";

/** The tagged outcome of a row read/write against Supabase (task 4.3 branches on it). */
type RowError =
  | { kind: "network" }
  | { kind: "unauthorized" }
  | { kind: "unknown"; message: string };

type ReadResult =
  | { ok: true; row: { payload: unknown; updated_at: string } | null }
  | { ok: false; error: RowError };

type WriteResult =
  | { ok: true; updatedAt: string }
  | { ok: false; error: RowError };

/**
 * Mutable controller state. Module-level so `startController`/`stopController`
 * and the (coming) store subscription and debounce timer share one instance.
 */
type ControllerState = {
  userId: string | null;
  /** Set when the cloud payload is too new for this app build (Req 6.4): all writes suppressed for the session. */
  writesSuppressed: boolean;
  /** The open Conflict_Prompt, or null. While non-null every write is deferred (Req 5.7). */
  pendingConflict: PendingConflict | null;
  /** Listeners notified when `pendingConflict` changes, so the modal (task 5.2) can react. */
  conflictListeners: Set<(c: PendingConflict | null) => void>;
  /** The current sync status surfaced to the toolbar chip (Req 9.5). */
  syncStatus: SyncStatus;
  /** Listeners notified when `syncStatus` changes, so the status chip (task 5.1) can mirror it. */
  statusListeners: Set<(s: SyncStatus) => void>;
  /**
   * The pending trailing-debounce timer for a steady-state write, or null when
   * none is scheduled. Cleared on stop and coalesced on each slice change.
   */
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /**
   * True when the current local slice has not yet landed in the cloud: a slice
   * change scheduled a write that hasn't succeeded, or the last write failed.
   * The next fire re-sends the then-current slice until this clears (Req 9.2–9.4).
   */
  dirty: boolean;
  /** True while a write is in flight, so a retry can't double-fire. */
  writeInFlight: boolean;
  /** Unsubscribe handle for the resume-store subscription, or null when not subscribed. */
  storeUnsubscribe: (() => void) | null;
  /** The last persisted-slice snapshot seen, to tell a real slice change from an unrelated store update. */
  lastSlice: Slice | null;
};

const state: ControllerState = {
  userId: null,
  writesSuppressed: false,
  pendingConflict: null,
  conflictListeners: new Set(),
  syncStatus: "synced",
  statusListeners: new Set(),
  debounceTimer: null,
  dirty: false,
  writeInFlight: false,
  storeUnsubscribe: null,
  lastSlice: null,
};

/** The trailing-debounce window for steady-state writes (design §"Steady-state writes"). */
const WRITE_DEBOUNCE_MS = 800;

// ---------------------------------------------------------------------------
// Last_Synced_Marker — localStorage, namespaced per user, read/written ONLY here
// ---------------------------------------------------------------------------

/** The per-user marker key. Namespacing by user keeps account switches from cross-contaminating. */
function markerKey(userId: string): string {
  return `resume-editor:sync-marker:${userId}`;
}

/** The last `updated_at` observed for `userId`, or null if this client never synced them. */
function readMarker(userId: string): string | null {
  try {
    return localStorage.getItem(markerKey(userId));
  } catch {
    return null;
  }
}

/** Record the `updated_at` this client last wrote/observed for `userId`. */
function setMarker(userId: string, updatedAt: string): void {
  try {
    localStorage.setItem(markerKey(userId), updatedAt);
  } catch {
    // A full/blocked storage is non-fatal: the next reconcile just treats the
    // cloud as newer and re-confirms. The marker is an optimisation, not state
    // of record.
  }
}

// ---------------------------------------------------------------------------
// Store access
// ---------------------------------------------------------------------------

/** The current persisted slice from the resume store ({variants, currentVariantId, bank}). */
function currentSlice(): Slice {
  const { variants, currentVariantId, bank } = useResumeStore.getState();
  return { variants, currentVariantId, bank };
}

function pushToast(message: string): void {
  useUiStore.getState().pushToast({ message });
}

// ---------------------------------------------------------------------------
// Row access (one row per user) — the single read/write primitives
// ---------------------------------------------------------------------------

/**
 * Maps a Supabase error to a tagged `RowError`. A missing JWT / expired session
 * surfaces as a 401 or a PostgREST `PGRST301`; everything that looks like a
 * transport failure is `network`. Task 4.3 turns `unauthorized` into a sign-out
 * and `network` into a stay-signed-in toast; here the callers just propagate.
 */
function classifyError(error: unknown): RowError {
  const e = error as { status?: number; code?: string; message?: string } | null;
  const status = e?.status;
  const code = e?.code;
  if (status === 401 || status === 403 || code === "PGRST301" || code === "401") {
    return { kind: "unauthorized" };
  }
  const message = e?.message ?? "";
  if (
    status === undefined &&
    (/fetch|network|Failed to fetch|timeout/i.test(message) || message === "")
  ) {
    return { kind: "network" };
  }
  return { kind: "unknown", message };
}

/** Read the user's single library row. `row === null` means no row exists yet. */
async function readRow(userId: string): Promise<ReadResult> {
  if (!supabase) return { ok: false, error: { kind: "unknown", message: "no client" } };
  const { data, error } = await supabase
    .from("libraries")
    .select("payload, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, error: classifyError(error) };
  return {
    ok: true,
    row: data ? { payload: data.payload, updated_at: data.updated_at as string } : null,
  };
}

/**
 * Upsert the user's library row (last-write-wins, single upsert keyed on the
 * user — Req 5.9) and return the database-maintained `updated_at`.
 */
async function writeRow(userId: string, payload: LibraryPayload): Promise<WriteResult> {
  if (!supabase) return { ok: false, error: { kind: "unknown", message: "no client" } };
  const { data, error } = await supabase
    .from("libraries")
    .upsert({ user_id: userId, payload }, { onConflict: "user_id" })
    .select("updated_at")
    .single();
  if (error) return { ok: false, error: classifyError(error) };
  return { ok: true, updatedAt: data.updated_at as string };
}

// ---------------------------------------------------------------------------
// Read/write failure handling (task 4.3 — Req 9.1, 9.6)
// ---------------------------------------------------------------------------

/**
 * A cloud read failed with a network error (Req 9.1). Stay signed in and keep
 * serving the Local_Library untouched — only surface a toast so the user knows
 * this exchange didn't reach the cloud. No store mutation, no marker change.
 */
function handleReadNetworkError(): void {
  pushToast(
    "Couldn't reach the cloud to sync. You're still signed in and your local copy is unchanged."
  );
}

/**
 * A request failed because the session is unauthorized — a 401 or an
 * expired-and-unrefreshable token (Req 9.6). Sign out to the Anonymous_State
 * via the auth `signOut` (which calls `supabase.auth.signOut()`), push a toast
 * asking the user to sign in again, and leave the resume store untouched. We do
 * NOT mutate controller lifecycle state here: `signOut` fires
 * `onAuthStateChange → SIGNED_OUT`, and task 5.3 maps that to
 * `stopController()`. Calling `signOut` is fire-and-forget on purpose so a
 * failing read/write path isn't blocked on the network round-trip.
 */
function handleUnauthorized(): void {
  pushToast("Your session expired. Please sign in again to resume cloud sync.");
  void signOut();
}

/**
 * Branch a tagged `RowError` from a read or write to the right 4.3 handler.
 * `network` → stay-signed-in toast (Req 9.1); `unauthorized` → sign out + toast
 * (Req 9.6); `unknown` is surfaced as a non-fatal toast so it isn't silent.
 */
function handleRowError(error: RowError): void {
  if (error.kind === "unauthorized") {
    handleUnauthorized();
    return;
  }
  if (error.kind === "network") {
    handleReadNetworkError();
    return;
  }
  pushToast("Cloud sync hit an unexpected error. Your local copy is unchanged.");
}

// ---------------------------------------------------------------------------
// Conflict seam (resolution lives in task 4.2; opening is state-only here)
// ---------------------------------------------------------------------------

function setPendingConflict(conflict: PendingConflict | null): void {
  state.pendingConflict = conflict;
  for (const listener of state.conflictListeners) listener(conflict);
}

// ---------------------------------------------------------------------------
// Sync status surface (feeds task 5.1's chip)
// ---------------------------------------------------------------------------

function setSyncStatus(status: SyncStatus): void {
  if (state.syncStatus === status) return;
  state.syncStatus = status;
  for (const listener of state.statusListeners) listener(status);
}

// ---------------------------------------------------------------------------
// Steady-state debounced writes (Req 5.8, 9.2–9.5; design §"Steady-state writes")
// ---------------------------------------------------------------------------

/** Clear any scheduled debounce timer without firing it. */
function cancelDebounce(): void {
  if (state.debounceTimer !== null) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
}

/**
 * Whether a steady-state write may run right now: signed in, not suppressed by
 * a too-new cloud (Req 6.4), and no Conflict_Prompt deferring writes (Req 5.7).
 */
function writesAllowed(): boolean {
  return (
    state.userId !== null &&
    !state.writesSuppressed &&
    state.pendingConflict === null
  );
}

/**
 * Fire a steady-state upsert. The payload is rebuilt from the THEN-CURRENT
 * slice (read here, at fire time, not when the write was scheduled), so a
 * retry after a failed write always re-sends the live content (Req 9.4). On a
 * network failure the marker is left untouched and the dirty flag stays set so
 * the next slice change — or a manual retry — re-sends (Req 9.2, 9.3). An
 * unauthorized write signs out to the Anonymous_State and asks the user to
 * re-auth, leaving the resume store untouched (Req 9.6).
 */
async function flushWrite(): Promise<void> {
  const userId = state.userId;
  if (userId === null || !writesAllowed()) return;
  if (state.writeInFlight) return;

  state.writeInFlight = true;
  setSyncStatus("pending");
  try {
    const write = await writeRow(userId, buildPayload(currentSlice()));
    // The session may have torn down (sign-out) while the write was in flight.
    if (state.userId !== userId) return;
    if (write.ok) {
      setMarker(userId, write.updatedAt);
      state.dirty = false;
      setSyncStatus("synced");
    } else if (write.error.kind === "network") {
      // Keep the marker and the dirty flag; the slice is retriable (Req 9.2).
      setSyncStatus("failed");
    } else if (write.error.kind === "unauthorized") {
      // Expired/unauthorized session: sign out to Anonymous_State and ask the
      // user to re-auth, leaving the resume store untouched (Req 9.6). The
      // marker is left unchanged and the slice stays dirty so a later sign-in
      // re-sends it. `signOut` fires SIGNED_OUT → task 5.3 stops the controller.
      setSyncStatus("failed");
      handleUnauthorized();
    } else {
      // Unknown error: surface a non-synced state without advancing the marker.
      setSyncStatus("failed");
    }
  } finally {
    state.writeInFlight = false;
  }
}

/**
 * Schedule a trailing debounced write. Coalesces rapid slice changes into one
 * upsert ~800 ms after the last change. Marks the slice dirty and moves the
 * chip to `pending` immediately so the UI reflects the unsaved edit.
 */
function scheduleWrite(): void {
  if (!writesAllowed()) return;
  state.dirty = true;
  setSyncStatus("pending");
  cancelDebounce();
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    void flushWrite();
  }, WRITE_DEBOUNCE_MS);
}

/** Whether two persisted slices are the same by reference on each key. */
function sliceUnchanged(a: Slice | null, b: Slice): boolean {
  return (
    a !== null &&
    a.variants === b.variants &&
    a.currentVariantId === b.currentVariantId &&
    a.bank === b.bank
  );
}

/**
 * Subscribe to the resume store and schedule a debounced write whenever the
 * persisted slice changes while writes are allowed. The store carries UI-free
 * content already; comparing the three persisted keys by reference filters out
 * store updates that don't touch the synced slice.
 */
function startStoreSubscription(): void {
  state.lastSlice = currentSlice();
  state.storeUnsubscribe = useResumeStore.subscribe(() => {
    const next = currentSlice();
    if (sliceUnchanged(state.lastSlice, next)) return;
    state.lastSlice = next;
    scheduleWrite();
  });
}

function stopStoreSubscription(): void {
  state.storeUnsubscribe?.();
  state.storeUnsubscribe = null;
  state.lastSlice = null;
}

// ---------------------------------------------------------------------------
// Initial reconcile (Req 4.1, 4.2, 4.5, 5.1, 5.3, 5.7, 6.2, 6.4, 6.5)
// ---------------------------------------------------------------------------

/**
 * The first exchange after entering signed-in for `userId`:
 *  - No row → upsert `buildPayload(localSlice)` and set the marker (Req 4.1).
 *  - Row → `reconcilePayloadVersion`:
 *      · `too_new`  → toast, suppress writes for the session, leave local alone (Req 6.4).
 *      · `invalid`  → toast, leave local alone (Req 6.5).
 *      · `ok`       → `isCloudNewer`?
 *          - not newer → merge locally + upsert, set the marker (Req 4.2, 5.1).
 *          - newer     → open the Conflict_Prompt and defer writes (Req 5.3, 5.7).
 *
 * A failed initial read never mutates local state. A network error keeps the
 * client signed in and serving local with a toast (Req 9.1); an unauthorized
 * error signs out and asks the user to re-auth (Req 9.6). Either way the
 * reconcile aborts without touching the store or the marker.
 */
async function runInitialReconcile(userId: string): Promise<void> {
  const read = await readRow(userId);
  if (!read.ok) {
    // A failed read never mutates local state; branch on the tagged error so a
    // network blip keeps us signed in (Req 9.1) while an expired session signs
    // out and asks to re-auth (Req 9.6).
    handleRowError(read.error);
    return;
  }

  // No row yet: this client seeds the cloud from its local library (Req 4.1).
  if (read.row === null) {
    const slice = currentSlice();
    const write = await writeRow(userId, buildPayload(slice));
    if (write.ok) setMarker(userId, write.updatedAt);
    return;
  }

  const reconciled = reconcilePayloadVersion(read.row.payload);
  if (reconciled.kind === "too_new") {
    // The cloud was written by a newer app build: refuse to downgrade it.
    state.writesSuppressed = true;
    pushToast(
      "This account's cloud library was saved by a newer version of the app. Update to sync; your local copy is unchanged."
    );
    return;
  }
  if (reconciled.kind === "invalid") {
    pushToast("The cloud library couldn't be read. Your local copy is unchanged.");
    return;
  }

  // reconciled.kind === "ok"
  const cloudPayload = reconciled.payload;
  const slice = currentSlice();

  if (isCloudNewer(read.row.updated_at, readMarker(userId))) {
    // Someone else advanced the cloud since this client last synced: defer to
    // the user rather than silently merging (Req 5.3, 5.7). Opening the prompt
    // is state-only here; task 4.2 resolves it, task 5.2 renders it.
    setPendingConflict({
      cloudPayload,
      cloudUpdatedAt: read.row.updated_at,
      localSlice: slice,
    });
    return;
  }

  // Cloud is not newer: fold it into local and push the union back (Req 4.2, 5.1).
  const merged = mergeLibraries(cloudPayload, slice);
  useResumeStore.getState().replaceLibrary(merged.variants, merged.bank);
  const write = await writeRow(userId, buildPayload(merged));
  if (write.ok) setMarker(userId, write.updatedAt);
}

// ---------------------------------------------------------------------------
// Conflict_Prompt resolution (Req 5.4–5.7; design §"Conflict_Prompt choices")
// ---------------------------------------------------------------------------

/**
 * Keep local (Req 5.4): upsert `buildPayload(localSlice)` to the cloud and set
 * the marker to the returned `updated_at`. The local library already holds what
 * the user wants, so nothing is written to the store. Closes the prompt and
 * resumes steady-state writes on success; a network failure closes the prompt
 * but leaves the chip `failed` with the slice dirty so a later edit re-sends.
 */
export async function resolveConflictKeepLocal(): Promise<void> {
  const conflict = state.pendingConflict;
  const userId = state.userId;
  if (conflict === null || userId === null) return;

  setPendingConflict(null);
  setSyncStatus("pending");
  const write = await writeRow(userId, buildPayload(conflict.localSlice));
  if (state.userId !== userId) return;
  if (write.ok) {
    setMarker(userId, write.updatedAt);
    state.dirty = false;
    setSyncStatus("synced");
  } else {
    // Keep the slice retriable; the local library is the source of record.
    state.dirty = true;
    setSyncStatus("failed");
  }
}

/**
 * Use cloud (Req 5.5): replace the local library with the fetched payload and
 * set the marker to the fetched row's `updated_at`. `replaceLibrary` forces
 * `currentVariantId` to `variants[0].id`, so when the payload names a different
 * (still-present) variant, restore it with `setCurrentVariant`. No write to the
 * cloud is needed: the cloud row already holds this content, so the marker
 * advances to its timestamp and the slice is clean.
 */
export function resolveConflictUseCloud(): void {
  const conflict = state.pendingConflict;
  const userId = state.userId;
  if (conflict === null || userId === null) return;

  const { cloudPayload, cloudUpdatedAt } = conflict;
  setPendingConflict(null);

  const store = useResumeStore.getState();
  store.replaceLibrary(cloudPayload.variants, cloudPayload.bank);
  const wanted = cloudPayload.currentVariantId;
  if (
    wanted &&
    wanted !== cloudPayload.variants[0]?.id &&
    cloudPayload.variants.some((v) => v.id === wanted)
  ) {
    useResumeStore.getState().setCurrentVariant(wanted);
  }

  setMarker(userId, cloudUpdatedAt);
  // The store change above fires the subscription; adopt the cloud slice as the
  // baseline and clear any dirty state so it doesn't schedule a redundant write.
  state.lastSlice = currentSlice();
  cancelDebounce();
  state.dirty = false;
  setSyncStatus("synced");
}

/**
 * Download backup (Req 5.6): export the local library as a JSON file through
 * the existing library export path, then re-open the same prompt so the user
 * still has to pick Keep local / Use cloud. Neither the store nor the cloud row
 * is touched (Req 5.7).
 */
export function resolveConflictDownloadBackup(): void {
  const conflict = state.pendingConflict;
  if (conflict === null) return;

  exportLibraryAsJsonFile(conflict.localSlice.variants, conflict.localSlice.bank);
  // Re-open: setting the same conflict re-notifies listeners so the modal stays up.
  setPendingConflict(conflict);
}

// ---------------------------------------------------------------------------
// Public lifecycle surface (wired to auth status by task 5.3)
// ---------------------------------------------------------------------------

/**
 * Enter signed-in for `userId` and run the initial reconcile. Idempotent per
 * user: starting the same user again is a no-op. Starting a different user
 * tears down the previous session first.
 *
 * Returns the reconcile promise so callers (and tests) can await the first
 * exchange. The steady-state store subscription is started after the reconcile
 * resolves so the merge/seed/use-cloud writes don't race the debounce.
 */
export function startController(userId: string): Promise<void> {
  if (state.userId === userId) return Promise.resolve();
  if (state.userId !== null) stopController();
  state.userId = userId;
  state.writesSuppressed = false;
  state.dirty = false;
  setSyncStatus("synced");
  return runInitialReconcile(userId).then(() => {
    // Only subscribe once this user is still the active session (a fast
    // sign-out during reconcile would have cleared it).
    if (state.userId === userId) startStoreSubscription();
  });
}

/**
 * Leave signed-in. Clears all per-session controller state — cancels the
 * pending debounce, unsubscribes from the store, drops the dirty flag — so a
 * later sign-in (same or different user) starts clean.
 */
export function stopController(): void {
  state.userId = null;
  state.writesSuppressed = false;
  cancelDebounce();
  stopStoreSubscription();
  state.dirty = false;
  state.writeInFlight = false;
  setPendingConflict(null);
  setSyncStatus("synced");
}

/**
 * Subscribe to Conflict_Prompt open/close. Returns an unsubscribe function.
 * Task 5.2's modal uses this to mirror `pendingConflict` into React state.
 */
export function subscribeConflict(
  listener: (conflict: PendingConflict | null) => void
): () => void {
  state.conflictListeners.add(listener);
  listener(state.pendingConflict);
  return () => state.conflictListeners.delete(listener);
}

/** The currently open Conflict_Prompt, or null. */
export function getPendingConflict(): PendingConflict | null {
  return state.pendingConflict;
}

/**
 * Subscribe to sync-status changes. Returns an unsubscribe function and calls
 * the listener once immediately with the current status. Task 5.1's chip uses
 * this to mirror `synced`/`pending`/`failed` into React state.
 */
export function subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
  state.statusListeners.add(listener);
  listener(state.syncStatus);
  return () => state.statusListeners.delete(listener);
}

/** The current sync status. */
export function getSyncStatus(): SyncStatus {
  return state.syncStatus;
}

/**
 * Manually retry a failed write (the status chip is clickable when `failed` —
 * Req 9.5). Re-sends the then-current slice through the same debounced path as
 * a steady-state edit; a no-op unless a write is actually pending/failed or the
 * slice is dirty. The payload is rebuilt at fire time, so the retry carries the
 * live content (Req 9.4).
 */
export function retrySync(): void {
  if (!writesAllowed()) return;
  if (!state.dirty && state.syncStatus !== "failed") return;
  scheduleWrite();
}
