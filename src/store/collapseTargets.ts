import type { Resume } from "./schema";

/**
 * Every id the two collapse levels are keyed by, read off the active variant
 * (3.2, 3.3).
 *
 * This is pure and takes a `Resume` rather than reaching into the store so the
 * Collapse all / Expand all buttons and a test can agree on the same answer.
 *
 * It walks the resume model, not the rendered tree, which is the whole point: a
 * collapsed section does not render its `ItemEditor`s, so a DOM-derived list
 * would miss every item under an already-collapsed section and Expand all would
 * leave those items shut. Item ids are collected across all sections — item ids
 * are unique within the variant, and `collapsedItems` is keyed by item id alone.
 */
export function collapseTargets(resume: Resume): {
  sectionIds: string[];
  itemIds: string[];
} {
  const sectionIds: string[] = [];
  const itemIds: string[] = [];
  for (const section of resume.sections) {
    sectionIds.push(section.id);
    for (const item of section.items) itemIds.push(item.id);
  }
  return { sectionIds, itemIds };
}
