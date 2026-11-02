import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Resume, BankItem } from "../store/schema";
import { PAYLOAD_VERSION, type LibraryPayload } from "./syncEngine";

/**
 * Sync controller tests (task 4.4) — the I/O shell exercised against a
 * hand-rolled fake of the `src/sync/supabase.ts` boundary.
 *
 * The controller (`syncController.ts`) is the only module that touches both the
 * resume store and the network, so to test its decisions-with-consequences we
 * fake exactly three module boundaries and leave the pure core + the zustand
 * stores real:
 *  - `./supabase`   — a programmable fake Supabase client whose `.from(...)`
 *     read/write chains resolve to test-controlled `{ data, error }`, with an
 *     `auth` stub. `fake.readResult` seeds the next `maybeSingle()`;
 *     `fake.writeResults` is a queue the next `single()` dequeues (falling back
 *     to a default success) and every upsert payload is recorded on
 *     `fake.upserts` so a test can assert what was sent.
 *  - `./useAuth`    — so the unauthorized path's `signOut` is observable.
 *  - `../exporters/importExport` — so Download-backup's `exportLibraryAsJsonFile`
 *     is observable without touching the DOM.
 *
 * The controller holds module-level state and an 800 ms debounce timer, so each
 * test imports it fresh (`vi.resetModules` + dynamic import), uses fake timers,
 * and calls `stopController()` in `afterEach` to keep state from leaking.
 *
 * The test env is "node" (vitest.config.ts), which has no `localStorage`; the
 * controller's Last_Synced_Marker reads/writes it, so we install a minimal
 * in-memory shim here.
 *
 * _Requirements: 4.1, 4.2, 5.4, 5.5, 5.6, 9.2, 9.4, 9.6_
 */

// ---------------------------------------------------------------------------
// localStorage shim (node env has none)
// ---------------------------------------------------------------------------

function installLocalStorage(): void {
  const map = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = shim;
}

// ---------------------------------------------------------------------------
// Fake Supabase boundary
// ---------------------------------------------------------------------------

type ReadData = { payload: unknown; updated_at: string } | null;
type QueryError = { status?: number; code?: string; message?: string } | null;

type WriteResult = { data: { updated_at: string } | null; error: QueryError };

type Fake = {
  /** Seeds the next read's resolved value. */
  readResult: { data: ReadData; error: QueryError };
  /** Dequeued one-per-write; empty ⇒ a default success at `defaultWriteTime`. */
  writeResults: WriteResult[];
  /** The `updated_at` a default write success returns, bumped per call. */
  defaultWriteTime: () => string;
  /** Every upsert's recorded `{ user_id, payload }` row, in call order. */
  upserts: { user_id: string; payload: LibraryPayload }[];
  /** Count of reads issued. */
  reads: number;
};

function makeFake(): Fake {
  let tick = 0;
  return {
    readResult: { data: null, error: null },
    writeResults: [],
    defaultWriteTime: () => `2024-01-01T00:00:${String(tick++).padStart(2, "0")}.000Z`,
    upserts: [],
    reads: 0,
  };
}

let fake: Fake;

// A single programmable supabase mock. The chain shapes mirror the controller's
// `readRow`/`writeRow` exactly: select→eq→maybeSingle and upsert→select→single.
vi.mock("./supabase", () => {
  const client = {
    from: (_table: string) => ({
      // read chain
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => {
            fake.reads += 1;
            return fake.readResult;
          },
        }),
      }),
      // write chain
      upsert: (row: { user_id: string; payload: LibraryPayload }) => {
        fake.upserts.push(row);
        return {
          select: (_cols: string) => ({
            single: async (): Promise<WriteResult> => {
              const next = fake.writeResults.shift();
              if (next) return next;
              return { data: { updated_at: fake.defaultWriteTime() }, error: null };
            },
          }),
        };
      },
    }),
    auth: {
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
  return { supabase: client, isSyncConfigured: true };
});

// Observe the sign-out path without running real auth.
const signOutMock = vi.fn(async () => { });
vi.mock("./useAuth", () => ({
  signOut: () => signOutMock(),
}));

// Observe Download-backup without touching the DOM.
const exportMock = vi.fn();
vi.mock("../exporters/importExport", () => ({
  exportLibraryAsJsonFile: (variants: Resume[], bank: BankItem[]) =>
    exportMock(variants, bank),
}));

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeResume(id: string, name = id): Resume {
  return {
    schemaVersion: 3,
    id,
    name,
    updatedAt: "2024-01-01T00:00:00.000Z",
    header: { fullName: name, fields: [] },
    sections: [],
  };
}

function cloudPayload(
  variants: Resume[],
  bank: BankItem[] = [],
  currentVariantId = variants[0]?.id ?? ""
): LibraryPayload {
  return { variants, currentVariantId, bank, payloadVersion: PAYLOAD_VERSION };
}

/**
 * Dynamically import the controller and the real resume store fresh, seed the
 * store with a known local slice, and return both. Fresh per test so the
 * controller's module-level state never leaks.
 */
async function load(localVariants: Resume[], localBank: BankItem[] = []) {
  const controller = await import("./syncController");
  const { useResumeStore } = await import("../store/resumeStore");
  useResumeStore.setState({
    variants: localVariants,
    bank: localBank,
    currentVariantId: localVariants[0].id,
  });
  return { controller, useResumeStore };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let activeStop: (() => void) | null = null;

beforeEach(() => {
  installLocalStorage();
  vi.resetModules();
  vi.useFakeTimers();
  fake = makeFake();
  signOutMock.mockClear();
  exportMock.mockClear();
});

afterEach(() => {
  // Clear module-level controller state so tests don't leak into each other.
  activeStop?.();
  activeStop = null;
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// (1) No existing row → first write seeds the cloud + sets the marker (Req 4.1)
// ---------------------------------------------------------------------------

describe("initial reconcile", () => {
  it("seeds the cloud from the local slice and sets the marker when no row exists (Req 4.1)", async () => {
    fake.readResult = { data: null, error: null };
    const { controller } = await load([makeResume("r1")], []);
    activeStop = controller.stopController;

    await controller.startController("user-1");

    expect(fake.reads).toBe(1);
    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0].user_id).toBe("user-1");
    expect(fake.upserts[0].payload.variants.map((v) => v.id)).toEqual(["r1"]);
    expect(fake.upserts[0].payload.payloadVersion).toBe(PAYLOAD_VERSION);
    // The marker now records the returned updated_at for this user.
    expect(localStorage.getItem("resume-editor:sync-marker:user-1")).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // (2) Existing row, not newer → merge writes BOTH store and cloud (Req 4.2)
  // -------------------------------------------------------------------------

  it("merges a not-newer cloud row into the store and writes the union back (Req 4.2)", async () => {
    // Cloud has r2 only; local has r1 only. Not-newer because no marker gate is
    // tripped: seed a marker equal to the row time so isCloudNewer is false.
    const rowTime = "2024-06-01T00:00:00.000Z";
    fake.readResult = {
      data: { payload: cloudPayload([makeResume("r2")]), updated_at: rowTime },
      error: null,
    };
    const { controller, useResumeStore } = await load([makeResume("r1")], []);
    activeStop = controller.stopController;
    // Marker == row time ⇒ cloud is NOT strictly newer (Req 5.2) ⇒ merge path.
    localStorage.setItem("resume-editor:sync-marker:user-1", rowTime);

    await controller.startController("user-1");

    // Store side: union of both variant ids (cloud first).
    const ids = useResumeStore.getState().variants.map((v) => v.id);
    expect(ids).toEqual(["r2", "r1"]);
    // Cloud side: the merged union was upserted back.
    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0].payload.variants.map((v) => v.id)).toEqual(["r2", "r1"]);
  });
});

// ---------------------------------------------------------------------------
// (3) Conflict_Prompt choices (Req 5.4, 5.5, 5.6)
// ---------------------------------------------------------------------------

describe("conflict resolution", () => {
  /** Drive the controller into an open Conflict_Prompt (cloud strictly newer). */
  async function openConflict() {
    // No marker ⇒ isCloudNewer treats the cloud as newer ⇒ prompt opens.
    fake.readResult = {
      data: {
        payload: cloudPayload([makeResume("cloud1")], [], "cloud1"),
        updated_at: "2024-06-01T00:00:00.000Z",
      },
      error: null,
    };
    const loaded = await load([makeResume("local1")], []);
    activeStop = loaded.controller.stopController;
    await loaded.controller.startController("user-1");
    // The prompt is open and no write happened yet (writes deferred — Req 5.7).
    expect(loaded.controller.getPendingConflict()).not.toBeNull();
    expect(fake.upserts).toHaveLength(0);
    return loaded;
  }

  it("Keep local upserts the local payload and sets the marker (Req 5.4)", async () => {
    const { controller } = await openConflict();

    await controller.resolveConflictKeepLocal();

    expect(controller.getPendingConflict()).toBeNull();
    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0].payload.variants.map((v) => v.id)).toEqual(["local1"]);
    expect(localStorage.getItem("resume-editor:sync-marker:user-1")).not.toBeNull();
    expect(controller.getSyncStatus()).toBe("synced");
  });

  it("Use cloud replaces the local library and advances the marker, no upsert (Req 5.5)", async () => {
    const { controller, useResumeStore } = await openConflict();

    controller.resolveConflictUseCloud();

    expect(controller.getPendingConflict()).toBeNull();
    // Store now holds the cloud variant.
    expect(useResumeStore.getState().variants.map((v) => v.id)).toEqual(["cloud1"]);
    // The marker advanced to the fetched row's updated_at; no cloud write needed.
    expect(localStorage.getItem("resume-editor:sync-marker:user-1")).toBe(
      "2024-06-01T00:00:00.000Z"
    );
    expect(fake.upserts).toHaveLength(0);
  });

  it("Download backup exports the local library and re-opens the prompt (Req 5.6)", async () => {
    const { controller } = await openConflict();

    controller.resolveConflictDownloadBackup();

    expect(exportMock).toHaveBeenCalledTimes(1);
    const [variants] = exportMock.mock.calls[0];
    expect((variants as Resume[]).map((v) => v.id)).toEqual(["local1"]);
    // The prompt stays open so the user still has to pick Keep local / Use cloud.
    expect(controller.getPendingConflict()).not.toBeNull();
    // Neither store nor cloud was mutated.
    expect(fake.upserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (4) Retry sends the CURRENT slice after a failed write (Req 9.2, 9.4)
// ---------------------------------------------------------------------------

describe("steady-state writes", () => {
  it("re-sends the then-current slice when a retry follows a failed write (Req 9.2, 9.4)", async () => {
    // Start cleanly from an existing-and-current row so no reconcile write fires.
    const rowTime = "2024-06-01T00:00:00.000Z";
    fake.readResult = {
      data: { payload: cloudPayload([makeResume("r1")]), updated_at: rowTime },
      error: null,
    };
    const { controller, useResumeStore } = await load([makeResume("r1")], []);
    activeStop = controller.stopController;
    localStorage.setItem("resume-editor:sync-marker:user-1", rowTime);

    await controller.startController("user-1");
    // The not-newer reconcile writes the merged union back once; measure from
    // that baseline so this test targets only the steady-state writes.
    const baseline = fake.upserts.length;

    // First steady-state edit → schedule a debounced write that FAILS (network).
    fake.writeResults = [{ data: null, error: { message: "Failed to fetch" } }];
    useResumeStore.setState({ variants: [makeResume("r1"), makeResume("r2")] });
    await vi.advanceTimersByTimeAsync(800);

    expect(fake.upserts).toHaveLength(baseline + 1);
    expect(fake.upserts[baseline].payload.variants.map((v) => v.id)).toEqual([
      "r1",
      "r2",
    ]);
    expect(controller.getSyncStatus()).toBe("failed");

    // Change the slice AGAIN, then retry: the retry must carry the NEW slice,
    // not the one captured when the failed write was scheduled (Req 9.4).
    useResumeStore.setState({
      variants: [makeResume("r1"), makeResume("r2"), makeResume("r3")],
    });
    controller.retrySync();
    await vi.advanceTimersByTimeAsync(800);

    expect(fake.upserts).toHaveLength(baseline + 2);
    expect(fake.upserts[baseline + 1].payload.variants.map((v) => v.id)).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
    expect(controller.getSyncStatus()).toBe("synced");
  });
});

// ---------------------------------------------------------------------------
// (5) Unauthorized → sign out (Req 9.6)
// ---------------------------------------------------------------------------

describe("unauthorized session", () => {
  it("drives the shared sign-out path when a read returns unauthorized (Req 9.6)", async () => {
    fake.readResult = { data: null, error: { status: 401 } };
    const { controller, useResumeStore } = await load([makeResume("r1")], []);
    activeStop = controller.stopController;

    await controller.startController("user-1");

    expect(signOutMock).toHaveBeenCalledTimes(1);
    // A failed read never mutates local state and never writes.
    expect(useResumeStore.getState().variants.map((v) => v.id)).toEqual(["r1"]);
    expect(fake.upserts).toHaveLength(0);
  });

  it("drives the shared sign-out path when a steady-state write returns unauthorized (Req 9.6)", async () => {
    const rowTime = "2024-06-01T00:00:00.000Z";
    fake.readResult = {
      data: { payload: cloudPayload([makeResume("r1")]), updated_at: rowTime },
      error: null,
    };
    const { controller, useResumeStore } = await load([makeResume("r1")], []);
    activeStop = controller.stopController;
    localStorage.setItem("resume-editor:sync-marker:user-1", rowTime);

    await controller.startController("user-1");

    fake.writeResults = [{ data: null, error: { status: 401 } }];
    useResumeStore.setState({ variants: [makeResume("r1"), makeResume("r2")] });
    await vi.advanceTimersByTimeAsync(800);

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(controller.getSyncStatus()).toBe("failed");
  });
});
