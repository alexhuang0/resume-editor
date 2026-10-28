import type { Item } from "./schema";

/**
 * Number of local bullets flagged `hidden` (task 7.3, design §5.7).
 * A detached item's `hidden` flags are baked from the variant's overlay, so
 * pushing them makes them bank-level: parked in every variant linked to the
 * entry.
 */
export function countHiddenBullets(item: Item): number {
  return item.bullets.filter((b) => b.hidden === true).length;
}

/** True when pushing `item` to the bank would park bullets bank-wide. */
export function pushWarnsHiddenBullets(item: Item): boolean {
  return countHiddenBullets(item) > 0;
}

/** Confirm text for the hidden-bullet warning shown before `pushItemToBank`. */
export function pushHiddenBulletsMessage(item: Item): string {
  const n = countHiddenBullets(item);
  return `${n} ${n === 1 ? "bullet is" : "bullets are"} hidden in this variant. Pushing makes ${
    n === 1 ? "it" : "them"
  } hidden in the bank, which hides ${
    n === 1 ? "it" : "them"
  } in EVERY variant linked to this entry. Continue?`;
}
