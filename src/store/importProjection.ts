// Pure projection for the guided bank bootstrap (design §4.3, Req 11.1-11.3).
// No React, no store imports, no id minting. It describes WHICH items in a
// variant's selected sections would be promoted to the bank, so the importer
// preview (10.3) and the apply step `importItemsToBank` (10.1) consult one
// source of truth and cannot disagree about the set.
import type { Resume, SectionKind } from "./schema";
import { bankItemDisplayLabel } from "./bankLabel";
import { linkState } from "./resolve";

/**
 * One row the importer would create: enough to preview the entry without
 * minting anything. `sectionId`/`itemId` identify the source item in the
 * variant; `kind` is the section's kind (bank entries carry a kind, items do
 * not); `label` is what the entry will read as in the bank list once created.
 */
export interface ImportProjectionEntry {
  sectionId: string;
  itemId: string;
  kind: SectionKind;
  label: string;
}

/**
 * The items that `importItemsToBank(variant.id, sectionIds)` would promote, in
 * encounter order (sections in variant order, items in section order).
 *
 * Qualifies exactly the LOCAL items (`linkState === "local"`) in the selected
 * sections — the same classifier the apply step uses — so linked and detached
 * items are skipped. Unknown variant, empty selection, a section id that is not
 * in the variant, or sections with no local items all yield an empty list.
 *
 * The `label` is derived with `bankItemDisplayLabel`, the same function the
 * bank list uses, so the preview matches what the user will see after import. A
 * freshly promoted entry has no explicit label, so this is the item's heading,
 * else "Untitled <kind>".
 *
 * Pure: the variant is not mutated and nothing is created.
 */
export function projectItemsToImport(
  variant: Resume | undefined,
  sectionIds: string[]
): ImportProjectionEntry[] {
  const entries: ImportProjectionEntry[] = [];
  if (!variant) return entries;

  const selected = new Set(sectionIds);
  for (const section of variant.sections) {
    if (!selected.has(section.id)) continue;
    for (const item of section.items) {
      if (linkState(item) !== "local") continue;
      entries.push({
        sectionId: section.id,
        itemId: item.id,
        kind: section.kind,
        // No label on a just-promoted entry; mirror bank-list derivation.
        label: bankItemDisplayLabel({ kind: section.kind, heading: item.heading }),
      });
    }
  }
  return entries;
}
