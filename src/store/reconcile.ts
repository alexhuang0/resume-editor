// Import-side reconciliation (design §4.7). Pure: no React, no zustand store,
// no DOM. `contentEquals` (9.3) is the comparison; `reconcileImportedItem`
// (9.4) is the per-item decision built on it; `reconcileVariant` (9.5) runs it
// over a whole variant and rolls the divergence count up for `parseImport`.
import { bakeOverlayKeepingContent, resolveItem } from "./resolve";
import type { BankItem, Bullet, Item, Resume } from "./schema";

/**
 * The part of an item that counts as "wording": the four content fields plus
 * the bullet list. Structural, so an `Item`, a `ResolvedItem` and a `BankItem`
 * are all acceptable operands.
 */
export type ItemContent = Pick<Item, "heading" | "subheading" | "location" | "dateRange"> & {
  bullets: readonly Bullet[];
};

/**
 * Normalization for the four content fields: `undefined` and `""` are the same
 * value. Both mean "no text", and the preview (`ResumePreview`) and Markdown
 * export treat them identically (falsy check), so no user-visible difference
 * exists between them. This also keeps a JSON round trip honest: a bank field
 * left `undefined` is dropped on serialize, while one cleared to `""` is kept,
 * and an external editor (Claude.ai) may add or drop an empty field.
 *
 * Deliberately NOT normalized: whitespace and case. `"Acme "` and `"Acme"` are
 * different strings the user could have typed, so they compare as different.
 * When in doubt this errs toward "diverged", which keeps the imported copy
 * (detached) instead of discarding it for the bank's wording.
 */
const field = (v: string | undefined): string => v ?? "";

/** `hidden` normalization: `undefined` and `false` are the same value. */
const isHidden = (b: Bullet): boolean => b.hidden === true;

/**
 * Do `a` and `b` carry the same wording?
 *
 * Compares exactly: `heading`, `subheading`, `location`, `dateRange` (with
 * `undefined` ≡ `""`), and the bullet list by `(id, text, hidden)` pairwise in
 * order (with `hidden` undefined ≡ `false`). Order matters: a reordered list
 * is a different list. So does length, and so does the bullet `id`.
 *
 * Deliberately ignored, because none of it is wording: `id`, item-level
 * `hidden`, `link`, `hiddenBulletIds`, `bulletOrder`, and anything else on the
 * operands (such as the resolver's `orphaned` flag).
 *
 * Operands for the import reconciler (design §4.7): the imported item against
 * `resolveItem(imported, bankById)`, that is, the bank's wording as resolved
 * under that item's OWN overlay. Never the raw bank entry. Export inlines the
 * overlay-applied view (hidden bullets removed, `bulletOrder` applied), so
 * against the raw entry every item with a non-empty `hiddenBulletIds` or
 * `bulletOrder` would read as diverged even though the user changed nothing.
 *
 * Pure, symmetric, reflexive. Neither argument is mutated.
 */
export function contentEquals(a: ItemContent, b: ItemContent): boolean {
  if (field(a.heading) !== field(b.heading)) return false;
  if (field(a.subheading) !== field(b.subheading)) return false;
  if (field(a.location) !== field(b.location)) return false;
  if (field(a.dateRange) !== field(b.dateRange)) return false;

  if (a.bullets.length !== b.bullets.length) return false;
  for (let i = 0; i < a.bullets.length; i++) {
    const x = a.bullets[i];
    const y = b.bullets[i];
    if (x.id !== y.id || x.text !== y.text || isHidden(x) !== isHidden(y)) return false;
  }
  return true;
}

/**
 * What `reconcileImportedItem` hands back.
 *
 * `item` is the item to store. `diverged` is `true` for exactly one outcome:
 * the item was linked, its bank entry exists, and its wording differs from the
 * bank's, so the imported copy was kept and detached (Req 10.3). Every other
 * outcome is `false`, including a link dropped because the bank entry is
 * missing (that is an orphan, not a divergence).
 *
 * Counting for the review toast (Req 10.4, task 9.5) is therefore a plain sum:
 * `count += r.diverged ? 1 : 0` per item, no re-inspection of `item`.
 */
export type ReconcileResult = { item: Item; diverged: boolean };

/** An item with no wording at all. Compared with `contentEquals`, so `undefined` ≡ `""`. */
const NO_WORDING: ItemContent = { bullets: [] };

/**
 * Decide what to store for one item that came in from an import (Req 10.3,
 * 10.5, design §4.7). Four branches, in this order:
 *
 * 1. No `link`: a local item. Passed through (same object).
 *
 * 2. `link.detached`: already a detached local copy. Its wording is the user's,
 *    not the bank's, so it is passed through (same object) and NEVER compared
 *    to the bank. Comparing it would take the "identical" branch whenever the
 *    user had not touched it since detaching, and that branch drops the
 *    wording, leaving a detached item with no content at all. This holds
 *    whether or not the bank entry exists.
 *
 * 3. Bank entry missing: the link is dangling and the overlay (which only means
 *    something against an entry) is meaningless. `link`, `hiddenBulletIds` and
 *    `bulletOrder` are dropped (the keys are omitted, not set to `undefined`)
 *    and whatever wording the item carries is kept as a local item. Not
 *    counted as diverged. If the item was a RAW linked item (see below) it has
 *    no wording, so the outcome is an empty local item. Nothing is invented:
 *    the wording was never in the file.
 *
 * 4. Bank entry present. The item is compared against `resolveItem(imported,
 *    bankById)`: the bank's wording as resolved under THIS item's overlay,
 *    never the raw entry. Export inlines the overlay-applied view, so against
 *    the raw entry every item with a non-empty `hiddenBulletIds` or
 *    `bulletOrder` would read as diverged. Outcomes:
 *    - Raw item (below): passed through, still linked, not diverged.
 *    - Identical: stays linked, keeps `hiddenBulletIds`/`bulletOrder`, and the
 *      duplicated wording is dropped so a linked item stores none (Req 5.4):
 *      the four content keys are omitted and `bullets` is `[]`, the same shape
 *      `addItemFromBank` creates. Not diverged.
 *    - Different: the imported copy is kept and detached with
 *      `bakeOverlayKeepingContent`: its wording and bullets (in its own order)
 *      are verbatim, bullets the overlay was hiding are re-attached from the
 *      bank as `hidden: true` after them, the overlay keys are cleared, and
 *      `link.detached = true`. Diverged.
 *
 * ## Raw linked items (library imports)
 *
 * A library file holds RAW variants: a linked item stores no wording, so it
 * arrives with empty content fields and `bullets: []`. Compared against the
 * resolved view that can never be equal, so without an exemption every linked
 * item in a library import would be detached and lose its link. A linked,
 * non-detached item whose OWN wording is empty (all four content fields empty,
 * `undefined` ≡ `""`, and `bullets.length === 0`) is therefore a raw item:
 * there is nothing to compare, and it passes through unchanged with its link
 * and overlay intact.
 *
 * What this does not misclassify. An INLINED item (single-variant export)
 * carries the bank's wording, so its wording is empty only if the bank entry
 * itself resolves to empty under its overlay. In that case raw and identical
 * agree (linked, no wording, not diverged), so the exemption changes nothing.
 * An inlined item with ANY wording, even a single character or a single
 * bullet, is not raw and is compared: an edited one is diverged and detached.
 *
 * The one residue, accepted: an inlined item whose wording was deliberately
 * blanked entirely (all four fields emptied and every bullet removed) in a file
 * whose bank entry has wording is indistinguishable, from the item alone, from
 * a raw library item, and is treated as raw: it stays linked and renders the
 * bank's wording again. Blanking an item is not the supported way to remove it
 * (the tailoring rules say `hidden: true`, not deletion), and the item-level
 * `hidden` flag is untouched, so a hidden item stays hidden.
 *
 * Pure: neither argument is mutated. The returned item is a valid `Item`.
 */
export function reconcileImportedItem(
  imported: Item,
  bankById: Map<string, BankItem>
): ReconcileResult {
  // 1. Local item.
  if (!imported.link) return { item: imported, diverged: false };

  // 2. Detached copy: the wording is the user's. Never compared to the bank.
  if (imported.link.detached) return { item: imported, diverged: false };

  // 3. Dangling link: drop it and the overlay, keep whatever content there is.
  const entry = bankById.get(imported.link.bankId);
  if (!entry) {
    const { link: _link, hiddenBulletIds: _hidden, bulletOrder: _order, ...local } = imported;
    return { item: local, diverged: false };
  }

  // 4a. Raw linked item (library import): no wording, nothing to compare.
  if (contentEquals(imported, NO_WORDING)) return { item: imported, diverged: false };

  // 4b. Identical to the bank under this item's own overlay: stay linked.
  if (contentEquals(imported, resolveItem(imported, bankById))) {
    const {
      heading: _heading,
      subheading: _subheading,
      location: _location,
      dateRange: _dateRange,
      ...linked
    } = imported;
    return { item: { ...linked, bullets: [] }, diverged: false };
  }

  // 4c. Different: keep the imported copy, detach it.
  return { item: bakeOverlayKeepingContent(imported, entry), diverged: true };
}

/** A reconciled variant plus how many of its items diverged from the bank. */
export type ReconcileVariantResult = { variant: Resume; diverged: number };

/**
 * Run `reconcileImportedItem` over every item of every section of `variant`
 * (Req 10.3) and sum the `diverged` flags (Req 10.4, task 9.5).
 *
 * Nothing here knows which bank it is given: the caller decides (the file's
 * own bank for a library import, the store's current bank for a single-variant
 * import, design §4.7). Items that need no change come back as the same
 * object (see `reconcileImportedItem`), so a variant with no `link` anywhere
 * is structurally unchanged, with a count of zero (Req 10.5).
 *
 * Pure: `variant` is not mutated.
 */
export function reconcileVariant(
  variant: Resume,
  bankById: Map<string, BankItem>
): ReconcileVariantResult {
  let diverged = 0;
  const sections = variant.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      const r = reconcileImportedItem(item, bankById);
      if (r.diverged) diverged += 1;
      return r.item;
    }),
  }));
  return { variant: { ...variant, sections }, diverged };
}

/**
 * The review message for an import's divergence count (Req 10.4), or `null`
 * when nothing diverged so the caller shows nothing extra.
 */
export function divergenceMessage(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const n = Math.floor(count);
  return `${n} ${n === 1 ? "item" : "items"} diverged from the bank — review`;
}

/**
 * Append the divergence message (if any) to an import toast's own message, so
 * the import produces one toast. Unchanged when the count is zero.
 */
export function withDivergence(message: string, count: number): string {
  const d = divergenceMessage(count);
  return d ? `${message}. ${d}` : message;
}
