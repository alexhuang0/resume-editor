// Pure lookup of a RAW (unresolved) item. No React, no store imports, so it can
// be unit-tested without a DOM. Re-exported from resumeStore.ts.
import type { Item, Resume } from "./schema";

/**
 * Finds an item in a variant's raw storage (variant -> section -> item).
 * Returns the object that already lives in the variant, never a copy, so a
 * zustand selector built on it is reference-stable. `undefined` when the
 * variant, section or item is absent.
 */
export function findRawItem(
  variant: Resume | undefined,
  sectionId: string,
  itemId: string
): Item | undefined {
  return variant?.sections
    .find((s) => s.id === sectionId)
    ?.items.find((i) => i.id === itemId);
}
