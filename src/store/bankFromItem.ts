// Pure construction of a bank entry from an item's wording (design §4.3).
// No React, no store imports. Shared by `promoteItemToBank` (7.4), and later
// `forkItemToNewBankItem` (7.5, called with the RESOLVED item) and
// `importItemsToBank` (10.1).
import type { BankItem, Item, SectionKind } from "./schema";
import { newId } from "./schema";

/**
 * Builds a fresh bank entry from `item`'s content fields and bullets.
 *
 * - `kind` is supplied by the caller (the section's kind); items carry none.
 * - heading/subheading/location/dateRange are copied exactly, undefined and
 *   empty strings included.
 * - bullets are copies with their ids PRESERVED, so overlay ids that later
 *   reference them stay meaningful. `hidden` flags are kept as written: a
 *   hidden bullet on the item becomes a bank-level hidden bullet, the same
 *   parity as `pushItemToBank`.
 * - No `label`. `id` is new ("bk"), `updatedAt` is now.
 *
 * Neither argument is mutated; the result shares no object with the input.
 */
export function bankEntryFromItem(item: Item, kind: SectionKind): BankItem {
  return {
    id: newId("bk"),
    kind,
    heading: item.heading,
    subheading: item.subheading,
    location: item.location,
    dateRange: item.dateRange,
    bullets: item.bullets.map((b) => ({ ...b })),
    updatedAt: new Date().toISOString(),
  };
}
