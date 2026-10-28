// Which bullet-row actions make sense for an item (task 8.3, design §4.3).
// Pure: no React, no store imports, so it is unit-testable without a DOM.
import { linkState } from "./resolve";
import type { BankItem, Item } from "./schema";

export type BulletRowActions = {
  /** True when the item shows bank wording (linked, entry present). */
  linked: boolean;
  /**
   * What the row's ✕ does. "hide" on a linked bullet: hiding is the
   * variant-local operation, deleting wording belongs in the Bank. "delete" is
   * the real delete-with-undo for local, detached and orphaned items.
   */
  deleteMode: "delete" | "hide";
  /** Duplicating a bank bullet is not variant-local, so it is off when linked. */
  canDuplicate: boolean;
};

/**
 * `item` is the RAW item (it carries the link state); `entry` is its bank
 * entry, or undefined when absent. A linked item whose entry is gone is an
 * orphan: its raw bullets hold its wording, so it behaves like a local item.
 */
export function bulletRowActions(
  item: Item | undefined,
  entry: BankItem | undefined
): BulletRowActions {
  const linked = !!item && linkState(item) === "linked" && !!entry;
  return {
    linked,
    deleteMode: linked ? "hide" : "delete",
    canDuplicate: !linked,
  };
}
