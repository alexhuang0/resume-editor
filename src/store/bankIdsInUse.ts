import type { Resume } from "./schema";

/**
 * Bank ids referenced by any item in the variant, for the "+ From bank"
 * picker's "in use" hint (9.3).
 *
 * Takes the RAW variant. Detached items still carry `link.bankId`, and they
 * are counted: a detached item is still "from" that entry, and the mark is a
 * visual hint, not a block (adding an entry twice stays allowed).
 */
export function bankIdsInUse(variant: Resume | undefined): Set<string> {
  const ids = new Set<string>();
  if (!variant) return ids;
  for (const section of variant.sections) {
    for (const item of section.items) {
      if (item.link?.bankId) ids.add(item.link.bankId);
    }
  }
  return ids;
}
