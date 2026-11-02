import { z } from "zod";
import { ResumeSchema, BankItemSchema } from "../store/schema";
import type { BankItem, Resume } from "../store/schema";
import { migratePersistedLibrary } from "../store/migrations";

/**
 * Pure sync-engine core. No network, no DOM, no import of the resume store.
 * Every export here is a function over plain data so it can be tested in
 * isolation (Req 12.1). The I/O shell (`syncController.ts`) wires these to the
 * Supabase client, the store, and the UI.
 */

/**
 * The cloud payload version stamp. MUST track the resumeStore persist `version`
 * (currently 3). Bumping the store's persisted schema requires bumping this.
 */
export const PAYLOAD_VERSION = 3 as const;

/**
 * The cloud payload shape: the persisted slice (`variants` + `currentVariantId`
 * + `bank`) plus an explicit version stamp. Note this is NOT `Library` from
 * schema.ts — that type carries `schemaVersion` and no `currentVariantId`.
 */
export const LibraryPayloadSchema = z.object({
  variants: z.array(ResumeSchema),
  currentVariantId: z.string(),
  bank: z.array(BankItemSchema).default([]),
  payloadVersion: z.number().int(),
});
export type LibraryPayload = z.infer<typeof LibraryPayloadSchema>;

/** The persisted resume-store slice the sync layer reads and merges. */
type Slice = {
  variants: Resume[];
  currentVariantId: string;
  bank: BankItem[];
};

/**
 * Builds the cloud payload from the persisted slice. Returns exactly the four
 * payload keys and nothing from uiStore (Req 4.6, 12.2, 12.3).
 */
export function buildPayload(slice: Slice): LibraryPayload {
  return {
    variants: slice.variants,
    currentVariantId: slice.currentVariantId,
    bank: slice.bank,
    payloadVersion: PAYLOAD_VERSION,
  };
}

/**
 * Unions two lists by `id`, keeping the first list's entry on a collision and
 * preserving insertion order (first list first). The result has no duplicate
 * ids (Req 12.4).
 */
function unionById<T extends { id: string }>(first: T[], second: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const entry of [...first, ...second]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push(entry);
  }
  return result;
}

/**
 * Merges the cloud payload with the local slice: union of variants and bank by
 * `id`, cloud winning on any collision and producing no duplicates (Req 4.2,
 * 4.3, 12.4, 12.5). `currentVariantId` resolves to the cloud value when it
 * still identifies a merged variant, otherwise the first merged variant
 * (Req 4.4).
 */
export function mergeLibraries(cloud: LibraryPayload, local: Slice): Slice {
  const variants = unionById(cloud.variants, local.variants);
  const bank = unionById(cloud.bank, local.bank);
  const currentVariantId = variants.some((v) => v.id === cloud.currentVariantId)
    ? cloud.currentVariantId
    : (variants[0]?.id ?? local.currentVariantId);
  return { variants, currentVariantId, bank };
}

/**
 * Whether the cloud row is strictly newer than the Last_Synced_Marker. Strict
 * `>` on parsed timestamps: equal timestamps are NOT newer (Req 5.2, 12.8). A
 * `null` marker (never synced this user) is treated as cloud-newer (Req 5.2).
 */
export function isCloudNewer(
  rowUpdatedAt: string,
  lastSyncedMarker: string | null
): boolean {
  if (lastSyncedMarker === null) return true;
  return Date.parse(rowUpdatedAt) > Date.parse(lastSyncedMarker);
}

/**
 * The outcome of reconciling a raw cloud payload against the current version.
 */
export type ReconcileResult =
  | { kind: "ok"; payload: LibraryPayload }
  | { kind: "too_new" }
  | { kind: "invalid" };

/**
 * Reconciles a raw cloud payload against `PAYLOAD_VERSION` (Req 6.2–6.5):
 * - above current → `too_new`, input left unmodified (Req 6.4, 12.7).
 * - below current → routes the slice through the existing
 *   `migratePersistedLibrary` (no local migration logic — Req 6.3) then
 *   validates (Req 6.2, 12.6).
 * - equal → validate directly.
 * - any schema failure → `invalid` (Req 6.5).
 */
export function reconcilePayloadVersion(raw: unknown): ReconcileResult {
  if (typeof raw !== "object" || raw === null) return { kind: "invalid" };

  const version = (raw as { payloadVersion?: unknown }).payloadVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { kind: "invalid" };
  }

  if (version > PAYLOAD_VERSION) return { kind: "too_new" };

  if (version < PAYLOAD_VERSION) {
    const migrated = migratePersistedLibrary(raw, version);
    const candidate = { ...migrated, payloadVersion: PAYLOAD_VERSION };
    const parsed = LibraryPayloadSchema.safeParse(candidate);
    return parsed.success
      ? { kind: "ok", payload: parsed.data }
      : { kind: "invalid" };
  }

  const parsed = LibraryPayloadSchema.safeParse(raw);
  return parsed.success
    ? { kind: "ok", payload: parsed.data }
    : { kind: "invalid" };
}
