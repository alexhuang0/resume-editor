import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { findRawItem } from "./findRawItem";
import { linkState, resolveItem } from "./resolve";
import {
  arbBankItem,
  arbOverlay,
  arbTwoVariantSharedEntryScenario,
} from "./resolveArbitraries";
import type { TwoVariantSharedEntryScenario } from "./resolveArbitraries";
import { useResumeStore } from "./resumeStore";
import type { BankItem, Item, Resume } from "./schema";
import { useUiStore } from "./uiStore";

/**
 * Feature: item-bank-and-editor-ux, Property 5: Overlays are variant-local
 *
 * For any single bank entry and any two distinct overlays, resolving against
 * each overlay yields a result matching that overlay alone, and neither
 * resolution mutates the bank entry or the other variant's item.
 *
 * Two layers. (1) Pure: two items in two variants link to ONE entry with
 * independently generated overlays (stale ids and repeats included); each
 * resolves to what its own overlay alone produces, replacing the other's
 * overlay changes nothing, and the entry is not mutated. (2) Real store:
 * random `toggleBulletHidden` / `reorderBullets` sequences applied to one
 * variant's item never touch the other variant, the bank, or either item's
 * link; the other variant's resolved view is unchanged by the interleaving.
 *
 * **Validates: Requirements 8.1, 8.2, 8.4**
 */

const NUM_RUNS = 150;

// --- independent expectation -------------------------------------------------

/** Expected resolved bullet ids from the overlay alone (not via the resolver). */
function expectedIds(entry: BankItem, overlay: Pick<Item, "hiddenBulletIds" | "bulletOrder">) {
  const hidden = new Set(overlay.hiddenBulletIds ?? []);
  const visible = entry.bullets.map((b) => b.id).filter((id) => !hidden.has(id));
  const inV = new Set(visible);
  const head: string[] = [];
  for (const id of overlay.bulletOrder ?? []) {
    if (inV.has(id) && !head.includes(id)) head.push(id);
  }
  const named = new Set(head);
  return [...head, ...visible.filter((id) => !named.has(id))];
}

/** What the page shows for a linked item: the entry's wording plus the overlay-projected bullets. */
function expectedView(entry: BankItem, overlay: Pick<Item, "hiddenBulletIds" | "bulletOrder">) {
  const byId = new Map(entry.bullets.map((b) => [b.id, b]));
  return {
    heading: entry.heading,
    subheading: entry.subheading,
    location: entry.location,
    dateRange: entry.dateRange,
    bullets: expectedIds(entry, overlay).map((id) => byId.get(id)),
  };
}

function view(item: Item) {
  return {
    heading: item.heading,
    subheading: item.subheading,
    location: item.location,
    dateRange: item.dateRange,
    bullets: item.bullets,
  };
}

const linkedItem = (
  id: string,
  bankId: string,
  overlay: Pick<Item, "hiddenBulletIds" | "bulletOrder">
): Item => ({ id, bullets: [], link: { bankId, detached: false }, ...overlay });

// --- layer 1: pure resolver ---------------------------------------------------

describe("Property 5: overlays are variant-local (resolver)", () => {
  it("each item resolves to its own overlay alone; the other overlay and the entry are untouched", () => {
    fc.assert(
      fc.property(
        arbBankItem.chain((entry) =>
          fc.tuple(
            fc.constant(entry),
            arbOverlay(entry.bullets),
            arbOverlay(entry.bullets),
            arbOverlay(entry.bullets)
          )
        ),
        ([entry, overlayA, overlayB, overlayOther]) => {
          const bank = new Map([[entry.id, entry]]);
          const entryBefore = structuredClone(entry);
          const itemA = linkedItem("item-a", entry.id, overlayA);
          const itemB = linkedItem("item-b", entry.id, overlayB);
          const itemsBefore = structuredClone([itemA, itemB]);

          const resolvedA = resolveItem(itemA, bank);
          const resolvedB = resolveItem(itemB, bank);

          // Each matches what its own overlay alone produces.
          expect(view(resolvedA)).toStrictEqual(expectedView(entry, overlayA));
          expect(view(resolvedB)).toStrictEqual(expectedView(entry, overlayB));
          expect(resolvedA.bullets.map((b) => b.id)).toStrictEqual(expectedIds(entry, overlayA));
          expect(resolvedB.bullets.map((b) => b.id)).toStrictEqual(expectedIds(entry, overlayB));

          // Neither depends on the other: swap B's overlay for anything else.
          const itemB2 = linkedItem("item-b", entry.id, overlayOther);
          expect(resolveItem(itemA, bank)).toStrictEqual(resolvedA);
          expect(view(resolveItem(itemB2, bank))).toStrictEqual(expectedView(entry, overlayOther));
          expect(resolveItem(itemA, bank)).toStrictEqual(resolvedA);
          // ... and the symmetric direction.
          const itemA2 = linkedItem("item-a", entry.id, overlayOther);
          expect(view(resolveItem(itemA2, bank))).toStrictEqual(expectedView(entry, overlayOther));
          expect(resolveItem(itemB, bank)).toStrictEqual(resolvedB);

          // Nothing was mutated: not the entry, not the items.
          expect(entry).toStrictEqual(entryBefore);
          expect([itemA, itemB]).toStrictEqual(itemsBefore);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("hiding in one variant leaves the other showing the bullet", () => {
    const entry: BankItem = {
      id: "bank-0",
      kind: "experience",
      bullets: [
        { id: "bul-0", text: "a" },
        { id: "bul-1", text: "b" },
        { id: "bul-2", text: "c" },
      ],
      updatedAt: "",
    };
    const bank = new Map([[entry.id, entry]]);
    const a = resolveItem(linkedItem("i", "bank-0", { hiddenBulletIds: ["bul-1"] }), bank);
    const b = resolveItem(linkedItem("i", "bank-0", { bulletOrder: ["bul-2"] }), bank);
    expect(a.bullets.map((x) => x.id)).toStrictEqual(["bul-0", "bul-2"]);
    expect(b.bullets.map((x) => x.id)).toStrictEqual(["bul-2", "bul-0", "bul-1"]);
  });
});

// --- layer 2: real store ------------------------------------------------------

type Action =
  | { kind: "toggle"; bulletId: string }
  | { kind: "reorder"; ids: string[] };

/** Bullet ids from `bul-0`..`bul-9`: the entry's own mixed with stale ones. */
function arbAction(entry: BankItem): fc.Arbitrary<Action> {
  const anyId = fc.oneof(
    fc.integer({ min: 0, max: 9 }).map((n) => `bul-${n}`),
    ...(entry.bullets.length ? [fc.constantFrom(...entry.bullets.map((b) => b.id))] : [])
  );
  return fc.oneof(
    anyId.map((bulletId): Action => ({ kind: "toggle", bulletId })),
    fc.array(anyId, { maxLength: 8 }).map((ids): Action => ({ kind: "reorder", ids }))
  );
}

const arbActions = (entry: BankItem) =>
  fc.array(arbAction(entry), { minLength: 1, maxLength: 6 });

const s = () => useResumeStore.getState();
const variantById = (id: string): Resume => s().variants.find((v) => v.id === id)!;

function load(scn: TwoVariantSharedEntryScenario) {
  useUiStore.setState({ toasts: [] });
  useResumeStore.setState({
    variants: scn.variants,
    currentVariantId: "variant-a",
    bank: scn.bank,
  });
}

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
});

const OVERLAY_KEYS = ["hiddenBulletIds", "bulletOrder"] as const;

describe("Property 5: overlays are variant-local (store)", () => {
  it("actions on one variant's item never touch the other variant, the bank, or the links", () => {
    fc.assert(
      fc.property(
        arbTwoVariantSharedEntryScenario().chain((scn) => {
          const entry = scn.bank.find((b) => b.id === scn.entryId)!;
          return fc.tuple(
            fc.constant(scn),
            arbActions(entry), // A
            arbActions(entry), // then B
            arbActions(entry) // then A again
          );
        }),
        ([scn, seqA1, seqB, seqA2]) => {
          load(scn);
          const entry = scn.bank.find((b) => b.id === scn.entryId)!;
          const bankRef = s().bank;
          const entryBefore = structuredClone(entry);
          const ids = ["variant-a", "variant-b"] as const;

          const raw = (side: 0 | 1) =>
            findRawItem(variantById(ids[side]), scn.sectionIds[side], scn.itemIds[side])!;
          const resolved = (side: 0 | 1) =>
            resolveItem(raw(side), new Map(s().bank.map((b) => [b.id, b])));

          const initialLinks = [raw(0).link, raw(1).link];

          const applyOn = (side: 0 | 1, action: Action) => {
            const other = (1 - side) as 0 | 1;
            const otherVariant = variantById(ids[other]);
            const otherItem = raw(other);
            const otherOverlay = OVERLAY_KEYS.map((k) => otherItem[k]);
            const otherResolved = resolved(other);

            s().setCurrentVariant(ids[side]);
            if (action.kind === "toggle") {
              s().toggleBulletHidden(scn.sectionIds[side], scn.itemIds[side], action.bulletId);
            } else {
              s().reorderBullets(scn.sectionIds[side], scn.itemIds[side], action.ids);
            }

            // The other variant is the very same object; its item and view are unchanged.
            expect(variantById(ids[other])).toBe(otherVariant);
            expect(raw(other)).toBe(otherItem);
            expect(OVERLAY_KEYS.map((k) => raw(other)[k])).toStrictEqual(otherOverlay);
            expect(resolved(other)).toStrictEqual(otherResolved);
            // Bank untouched: same array, same entry content.
            expect(s().bank).toBe(bankRef);
            expect(entry).toStrictEqual(entryBefore);
            // Both items stay linked with no local content.
            for (const side2 of [0, 1] as const) {
              const item = raw(side2);
              expect(linkState(item)).toBe("linked");
              expect(item.link).toStrictEqual(initialLinks[side2]);
              expect(item.link?.bankId).toBe(scn.entryId);
              expect(item.bullets).toStrictEqual([]);
              for (const key of ["heading", "subheading", "location", "dateRange"] as const) {
                expect(key in item).toBe(false);
              }
            }
          };

          const bOverlayInitial = OVERLAY_KEYS.map((k) => raw(1)[k]);

          // Phase 1: act on A only. B's overlay is exactly what it started as.
          for (const action of seqA1) applyOn(0, action);
          expect(OVERLAY_KEYS.map((k) => raw(1)[k])).toStrictEqual(bOverlayInitial);
          expect(view(resolved(1))).toStrictEqual(
            expectedView(entry, { hiddenBulletIds: bOverlayInitial[0], bulletOrder: bOverlayInitial[1] })
          );

          // Phase 2: act on B only. A's item is the very object phase 1 left.
          const aAfterPhase1 = raw(0);
          for (const action of seqB) applyOn(1, action);
          expect(raw(0)).toBe(aAfterPhase1);

          // Phase 3 (interleaved A, B, A): A's second burst never changes B's view.
          const bResolvedBefore = resolved(1);
          const bRawBefore = raw(1);
          for (const action of seqA2) applyOn(0, action);
          expect(raw(1)).toBe(bRawBefore);
          expect(resolved(1)).toStrictEqual(bResolvedBefore);

          // Each final view is the projection of its OWN overlay alone.
          for (const side of [0, 1] as const) {
            expect(view(resolved(side))).toStrictEqual(expectedView(entry, raw(side)));
          }
          expect(s().bank).toBe(bankRef);
          expect(entry).toStrictEqual(entryBefore);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
