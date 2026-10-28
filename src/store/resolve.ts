// Resolve-on-read (design §4.2). Pure: no React, no store imports.
// The bank owns wording; the variant owns identity, visibility and order.
import type { BankItem, Bullet, Item, Resume, Section } from "./schema";
import { reorderByIds } from "./reorderByIds";

export type ResolvedItem = Item & { orphaned?: boolean };
export type LinkState = "linked" | "detached" | "local";

/** One classifier, used by the badges (7.8) and by Property 9. */
export function linkState(item: Item): LinkState {
  if (!item.link) return "local";
  return item.link.detached ? "detached" : "linked";
}

/**
 * True when the item carries a link (linked or detached) but no bank entry
 * with that id exists: the safety-net case (design §4.2). Local items are
 * never orphaned.
 */
export function isOrphaned(item: Item, bank: readonly BankItem[]): boolean {
  if (!item.link) return false;
  const bankId = item.link.bankId;
  return !bank.some((b) => b.id === bankId);
}

export function resolveItem(item: Item, bankById: Map<string, BankItem>): ResolvedItem {
  // Branch 2: local or detached. Today's behavior, same object back.
  if (!item.link || item.link.detached) return item;

  // Safety net: the bank entry is gone. Own fields (empty for a linked item),
  // flagged so the editor can offer recovery. Never throws.
  const entry = bankById.get(item.link.bankId);
  if (!entry) return { ...item, orphaned: true };

  const hiddenIds = item.hiddenBulletIds;
  const visible = hiddenIds?.length
    ? entry.bullets.filter((b) => !hiddenIds.includes(b.id))
    : entry.bullets;
  const bullets = item.bulletOrder?.length
    ? reorderByIds(visible, item.bulletOrder) // unknown ids append
    : visible;

  return {
    id: item.id,
    hidden: item.hidden,
    link: item.link,
    // Already applied to `bullets`; carried so the exported artifact keeps the
    // overlay and the import-side divergence check does not misfire.
    hiddenBulletIds: item.hiddenBulletIds,
    bulletOrder: item.bulletOrder,
    heading: entry.heading,
    subheading: entry.subheading,
    location: entry.location,
    dateRange: entry.dateRange,
    bullets,
  };
}

/*
 * Baking (design §4.3, §4.7). Two entry points, one set of rules.
 *
 * The rules, wherever the wording comes from:
 *   1. A bullet the overlay hides (`hiddenBulletIds`) is never dropped. It is
 *      kept as a local COPY of the bank bullet flagged `hidden: true`, because
 *      `ResumePreview` and `toMarkdown` already filter `hidden`.
 *   2. The overlay keys (`hiddenBulletIds`, `bulletOrder`) are omitted from the
 *      result: a detached item keeps visibility in `bullet.hidden` and array
 *      order only.
 *   3. The link survives, flagged `detached: true`, so resync stays available.
 *
 * The entry points differ only in where the wording and the base bullet list
 * come from: `bakeOverlay` takes both from the bank entry (the linked item has
 * none of its own), `bakeOverlayKeepingContent` takes both from the item (an
 * imported copy that carries its own wording and must keep it). The helpers
 * below hold rules 1 to 3 so neither entry point can drift from the other.
 */

/** Rule 1: a bank bullet the overlay hides, as a hidden local copy. */
const hiddenCopy = (b: Bullet): Bullet => ({ ...b, hidden: true });

/** Rules 2 and 3: overlay keys out, link kept and flagged detached. */
function detachedWith(item: Item, entry: BankItem, over: Partial<Item>, bullets: Bullet[]): Item {
  const { hiddenBulletIds: _hiddenBulletIds, bulletOrder: _bulletOrder, ...rest } = item;
  return {
    ...rest,
    ...over,
    bullets,
    link: { ...item.link, bankId: item.link?.bankId ?? entry.id, detached: true },
  };
}

/**
 * Bake a linked item's visibility overlay into local content (design §4.3).
 * Shared by `detachItem` (7.1) and the other store paths that turn a linked
 * item into a local one; the diverged-import path (9.4) uses its sibling
 * `bakeOverlayKeepingContent`. Pure; neither argument is mutated.
 *
 * Returns a new, detached item holding the bank entry's content fields and ALL
 * of its bullets (copies), ordered per `bulletOrder` (unknown ids append), with
 * `hidden: true` on every bullet named in `hiddenBulletIds`. The overlay keys
 * are omitted from the result. The rendered output is unchanged: the bullets
 * with `!hidden` equal what `resolveItem` returned for the linked item.
 *
 * The item's OWN wording is ignored (a linked item has none), so do not use
 * this where the item's wording must survive; see `bakeOverlayKeepingContent`.
 */
export function bakeOverlay(item: Item, entry: BankItem): Item {
  const hiddenIds = new Set(item.hiddenBulletIds ?? []);
  const ordered = item.bulletOrder?.length
    ? reorderByIds(entry.bullets, item.bulletOrder)
    : entry.bullets;
  const bullets = ordered.map((b) => (hiddenIds.has(b.id) ? hiddenCopy(b) : { ...b }));
  return detachedWith(
    item,
    entry,
    {
      heading: entry.heading,
      subheading: entry.subheading,
      location: entry.location,
      dateRange: entry.dateRange,
    },
    bullets
  );
}

/**
 * The diverged-import flavour of `bakeOverlay` (task 9.4, design §4.7): detach
 * an item that carries its OWN inlined wording, keeping that wording.
 *
 * Why not `bakeOverlay`: it copies content fields and bullets from the BANK
 * ENTRY and ignores the item's. On an import that is the wrong source, since
 * the imported copy (edited by the user or by Claude.ai) is exactly what must
 * be kept. Baking over the entry would replace those edits with the bank's
 * wording.
 *
 * What it keeps: every content field and every bullet of `item`, verbatim and
 * in the item's own order (copies). The inlined bullets of an exported file
 * are already the overlay-applied view (hidden bullets removed, `bulletOrder`
 * applied), and an explicit reorder by the editor of the file is an edit worth
 * keeping, so `bulletOrder` is NOT re-applied here.
 *
 * What it re-attaches: the bullets this variant was hiding. For each id in
 * `hiddenBulletIds` that the bank entry has and the item's bullets do not, a
 * copy of the bank bullet with `hidden: true` (rule 1), so the information
 * survives the round trip and can be un-hidden after the detach.
 *
 * Placement (deterministic): re-attached bullets go AFTER all of the item's own
 * bullets, in the bank entry's order, regardless of the order of ids in
 * `hiddenBulletIds`. They are invisible, so position only matters once the
 * user un-hides one, and "at the end" is the same append-unknown rule as
 * `reorderByIds` / the resolver. An id the item already inlines is left alone,
 * as the imported copy wins: it stays visible if it came back visible. An id
 * the bank entry no longer has is ignored (nothing to re-attach).
 *
 * Pure; neither argument is mutated, bullets are copied. The result is
 * detached, has no overlay keys, and keeps `id`, `hidden` and the link's
 * `bankId`.
 */
export function bakeOverlayKeepingContent(item: Item, entry: BankItem): Item {
  const hiddenIds = new Set(item.hiddenBulletIds ?? []);
  const inlined = new Set(item.bullets.map((b) => b.id));
  const reattached = entry.bullets
    .filter((b) => hiddenIds.has(b.id) && !inlined.has(b.id))
    .map(hiddenCopy);
  return detachedWith(item, entry, {}, [...item.bullets.map((b) => ({ ...b })), ...reattached]);
}

/**
 * The bullets of `entry` that a linked item's overlay hides (`hiddenBulletIds`),
 * in the entry's order, as copies. `resolveItem` filters these out entirely, so
 * this is how the editor can list them for un-hiding (design §4.3, Req 8.1)
 * without changing what preview/markdown/export see. Ids in `hiddenBulletIds`
 * that the entry no longer has are ignored. Pure; neither argument is mutated.
 */
export function overlayHiddenBullets(item: Item, entry: BankItem): Bullet[] {
  const hiddenIds = item.hiddenBulletIds;
  if (!hiddenIds?.length) return [];
  const ids = new Set(hiddenIds);
  return entry.bullets.filter((b) => ids.has(b.id)).map((b) => ({ ...b }));
}

/**
 * Resolve every item of a variant. Preserves structural sharing: a section
 * whose items all resolve to themselves is returned as-is, and so is the
 * variant when no section changed. `orphaned` rides on items at runtime;
 * ResolvedItem is assignable to Item so the return type stays `Resume`.
 */
export function resolveResume(variant: Resume, bank: BankItem[]): Resume {
  const bankById = new Map(bank.map((b) => [b.id, b]));

  let changed = false;
  const sections = variant.sections.map((section): Section => {
    let sectionChanged = false;
    const items = section.items.map((item) => {
      const resolved = resolveItem(item, bankById);
      if (resolved !== item) sectionChanged = true;
      return resolved;
    });
    if (!sectionChanged) return section;
    changed = true;
    return { ...section, items };
  });

  return changed ? { ...variant, sections } : variant;
}
