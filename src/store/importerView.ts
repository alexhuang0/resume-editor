// Pure view helpers for the guided bank importer (task 10.3, design §4.3,
// Req 11.1-11.2). No React, no store imports, no id minting. The component that
// drives the importer flow stays thin by delegating its non-trivial logic here,
// where it can be unit-tested without rendering (vitest is scoped to pure
// modules in this project).
import type { Resume } from "./schema";
import { projectItemsToImport } from "./importProjection";
import { linkState } from "./resolve";

/**
 * One selectable section in the importer's checkbox step: the section's id and
 * title plus the number of items that WOULD be promoted if it is selected. The
 * count comes from the same `linkState === "local"` rule the projection and the
 * apply step use, so a section showing "0" cannot contribute a surprise entry.
 */
export interface ImporterSection {
  id: string;
  title: string;
  kind: Resume["sections"][number]["kind"];
  /** How many local (importable) items this section holds. */
  importableCount: number;
}

/**
 * The sections of `variant` the importer offers, in variant order. Every
 * section is listed — including ones with no importable items — so the user can
 * see the whole variant, but `importableCount` tells the UI which ones would
 * actually create entries. An absent variant yields an empty list.
 *
 * Pure: the variant is not mutated.
 */
export function importerSections(variant: Resume | undefined): ImporterSection[] {
  if (!variant) return [];
  return variant.sections.map((section) => ({
    id: section.id,
    title: section.title,
    kind: section.kind,
    importableCount: section.items.filter((it) => linkState(it) === "local")
      .length,
  }));
}

/**
 * How many entries the importer would create for `variant` given the current
 * section selection. Delegates to `projectItemsToImport` so the preview count
 * and the "confirm" apply step can never disagree about the set.
 */
export function importCount(
  variant: Resume | undefined,
  sectionIds: string[]
): number {
  return projectItemsToImport(variant, sectionIds).length;
}

/**
 * Confirmation-toast copy after an import, with singular/plural agreement:
 * `1` → "Imported 1 item to the bank", `n` → "Imported n items to the bank".
 * A zero or negative count (nothing created) still reads sensibly.
 */
export function importedToastMessage(count: number): string {
  const noun = count === 1 ? "item" : "items";
  return `Imported ${count} ${noun} to the bank`;
}
