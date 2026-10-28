import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { findRawItem } from "./findRawItem";
import { linkState, resolveItem } from "./resolve";
import { arbLinkedItemScenario } from "./resolveArbitraries";
import type { ItemScenario } from "./resolveArbitraries";
import { useResumeStore } from "./resumeStore";
import type { BankItem, Item, Resume } from "./schema";
import { useUiStore } from "./uiStore";

/**
 * Feature: item-bank-and-editor-ux, Property 13: Detach then resync returns to
 * the bank's wording
 *
 * For any linked item (bank entry present), an optional explicit detach, then
 * any sequence of 0-5 wording edits (`updateItem` patches, `updateBullet`,
 * `addBullet`; the first one auto-detaches), then `resyncItem`:
 *  - when the item is detached at that point, resync leaves it "linked" to the
 *    same entry with no local content and no overlay keys (id and hidden kept),
 *    and it resolves EXACTLY to the entry's wording, bullets unfiltered and in
 *    the entry's order (the overlay is discarded, not reconstructed: hidden-by-
 *    overlay bullets reappear, design §4.3);
 *  - it resolves to the NEW wording if the bank entry is edited between the
 *    detach and the resync, and the bank is otherwise never touched;
 *  - a second resync is a no-op (state-reference-equal, no toast);
 *  - exactly one toast is pushed, with the documented message, and its undo
 *    restores the exact pre-resync raw item;
 *  - other items, sections and variants keep object identity;
 *  - when the item is still linked (no edit happened) resync is a no-op, no toast.
 *
 * Runs against the real store; the expected values are computed here from the
 * generated bank entry, independently of the store.
 *
 * **Validates: Requirements 7.4**
 */

const NUM_RUNS = 150;
const MESSAGE = "Resynced from bank — local wording and hidden bullets replaced";

// --- store helpers -----------------------------------------------------------

const s = () => useResumeStore.getState();
const toasts = () => useUiStore.getState().toasts;
const current = (): Resume => s().variants.find((v) => v.id === s().currentVariantId)!;
const raw = (scn: ItemScenario): Item => findRawItem(current(), scn.sectionId, scn.itemId)!;
const bankMap = () => new Map(s().bank.map((b) => [b.id, b]));
const entryOf = (bankId: string): BankItem => s().bank.find((b) => b.id === bankId)!;

function load(scn: ItemScenario) {
  useUiStore.setState({ toasts: [] });
  useResumeStore.setState({
    variants: scn.variants,
    currentVariantId: scn.currentVariantId,
    bank: scn.bank,
  });
}

// --- edit generators ---------------------------------------------------------

const text = fc.string({ maxLength: 20 });

type Edit =
  | { kind: "item"; patch: Partial<Pick<Item, "heading" | "subheading" | "location" | "dateRange">> }
  | { kind: "updateBullet"; at: number; text: string }
  | { kind: "addBullet"; at: number; after: boolean };

const arbEdit: fc.Arbitrary<Edit> = fc.oneof(
  fc
    .record(
      { heading: text, subheading: text, location: text, dateRange: text },
      { requiredKeys: [] }
    )
    .filter((p) => Object.keys(p).length > 0)
    .map((patch): Edit => ({ kind: "item", patch })),
  fc.record({ kind: fc.constant("updateBullet" as const), at: fc.nat(), text }),
  fc.record({ kind: fc.constant("addBullet" as const), at: fc.nat(), after: fc.boolean() })
);

function applyEdit(scn: ItemScenario, edit: Edit) {
  const bullets = raw(scn).bullets;
  switch (edit.kind) {
    case "item":
      s().updateItem(scn.sectionId, scn.itemId, edit.patch);
      break;
    case "updateBullet": {
      // Falls back to an id no bullet has: still a wording edit (auto-detaches).
      const id = bullets.length ? bullets[edit.at % bullets.length].id : "nope";
      s().updateBullet(scn.sectionId, scn.itemId, id, edit.text);
      break;
    }
    case "addBullet": {
      const after = edit.after && bullets.length ? bullets[edit.at % bullets.length].id : undefined;
      s().addBullet(scn.sectionId, scn.itemId, after);
      break;
    }
  }
}

interface BankEdit {
  heading: string;
  bulletAt: number;
  bulletText: string;
}
const arbBankEdit: fc.Arbitrary<BankEdit | null> = fc.option(
  fc.record({ heading: text, bulletAt: fc.nat(), bulletText: text }),
  { nil: null }
);

/** Edit the bank entry through the real bank actions. */
function editBank(bankId: string, edit: BankEdit) {
  s().updateBankItem(bankId, { heading: edit.heading });
  const bullets = entryOf(bankId).bullets;
  if (bullets.length) {
    s().updateBankBullet(bankId, bullets[edit.bulletAt % bullets.length].id, edit.bulletText);
  }
}

/** The raw item has no content of its own and no overlay keys. */
function expectNoLocalContentOrOverlay(item: Item) {
  expect(item.bullets).toStrictEqual([]);
  for (const key of ["heading", "subheading", "location", "dateRange"] as const) {
    expect(key in item).toBe(false);
  }
  expect("hiddenBulletIds" in item).toBe(false);
  expect("bulletOrder" in item).toBe(false);
}

/** Resolving `item` yields exactly the entry's wording and full, ordered bullet list. */
function expectResolvesToEntry(item: Item, entry: BankItem) {
  const resolved = resolveItem(item, bankMap());
  expect(resolved.orphaned).toBeUndefined();
  expect(resolved.heading).toBe(entry.heading);
  expect(resolved.subheading).toBe(entry.subheading);
  expect(resolved.location).toBe(entry.location);
  expect(resolved.dateRange).toBe(entry.dateRange);
  expect(resolved.bullets).toStrictEqual(entry.bullets);
}

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
});

describe("Property 13: detach then resync returns to the bank's wording", () => {
  it("any detach / edits / (bank edit) / resync sequence ends at the bank's wording", () => {
    fc.assert(
      fc.property(
        arbLinkedItemScenario(),
        fc.boolean(),
        fc.array(arbEdit, { maxLength: 5 }),
        arbBankEdit,
        (scn, detachFirst, edits, bankEdit) => {
          load(scn);
          const initial = raw(scn);
          const bankId = initial.link!.bankId;
          expect(entryOf(bankId)).toBeDefined();

          if (detachFirst) s().detachItem(scn.sectionId, scn.itemId);
          for (const edit of edits) applyEdit(scn, edit);
          if (bankEdit) editBank(bankId, bankEdit);

          const detached = linkState(raw(scn)) === "detached";
          expect(detached).toBe(detachFirst || edits.length > 0);

          // Snapshot everything resync must leave alone.
          const before = raw(scn);
          const beforeSnapshot = structuredClone(before);
          const bankBefore = s().bank;
          const bankBeforeCopy = structuredClone(bankBefore);
          const variantsBefore = s().variants;
          const section = current().sections.find((x) => x.id === scn.sectionId)!;
          const otherItems = section.items.filter((i) => i.id !== scn.itemId);
          const otherSections = current().sections.filter((x) => x.id !== scn.sectionId);
          const otherVariants = s().variants.filter((v) => v.id !== scn.currentVariantId);
          const toastsBefore = toasts().length;

          s().resyncItem(scn.sectionId, scn.itemId);

          if (!detached) {
            // Still linked: nothing to resync.
            expect(s().variants).toBe(variantsBefore);
            expect(s().bank).toBe(bankBefore);
            expect(toasts()).toHaveLength(toastsBefore);
            return;
          }

          // (a) linked again, same entry, no local content, id/hidden kept.
          const after = raw(scn);
          expect(linkState(after)).toBe("linked");
          expect(after.link).toStrictEqual({ bankId });
          expect("detached" in after.link!).toBe(false);
          expectNoLocalContentOrOverlay(after);
          expect(after.id).toBe(initial.id);
          expect("hidden" in after).toBe("hidden" in initial);
          expect(after.hidden).toBe(initial.hidden);

          // (b) resolves exactly to the bank entry (as it is now).
          expectResolvesToEntry(after, entryOf(bankId));

          // (c) the bank is untouched by resync.
          expect(s().bank).toBe(bankBefore);
          expect(s().bank).toStrictEqual(bankBeforeCopy);
          if (bankEdit) {
            expect(entryOf(bankId).heading).toBe(bankEdit.heading);
          }

          // (f) identity of everything else.
          const sectionAfter = current().sections.find((x) => x.id === scn.sectionId)!;
          expect(sectionAfter.items.map((i) => i.id)).toStrictEqual(section.items.map((i) => i.id));
          const otherItemsAfter = sectionAfter.items.filter((i) => i.id !== scn.itemId);
          expect(otherItemsAfter).toHaveLength(otherItems.length);
          otherItems.forEach((i, k) => expect(otherItemsAfter[k]).toBe(i));
          const otherSectionsAfter = current().sections.filter((x) => x.id !== scn.sectionId);
          otherSections.forEach((x, k) => expect(otherSectionsAfter[k]).toBe(x));
          s()
            .variants.filter((v) => v.id !== scn.currentVariantId)
            .forEach((v, k) => expect(v).toBe(otherVariants[k]));

          // (e) exactly one toast, documented message, with an undo.
          expect(toasts()).toHaveLength(toastsBefore + 1);
          const toast = toasts()[toasts().length - 1];
          expect(toast.message).toBe(MESSAGE);
          expect(toast.undo).toBeTypeOf("function");

          // (d) a second resync is a no-op and pushes nothing.
          const variantsAfter = s().variants;
          s().resyncItem(scn.sectionId, scn.itemId);
          expect(s().variants).toBe(variantsAfter);
          expect(raw(scn)).toBe(after);
          expect(toasts()).toHaveLength(toastsBefore + 1);

          // (e) undo restores the exact pre-resync raw item (baked flags, local edits).
          toast.undo!();
          expect(raw(scn)).toStrictEqual(beforeSnapshot);
          expect(linkState(raw(scn))).toBe("detached");
          expect(s().bank).toBe(bankBefore);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("hidden-by-overlay bullets reappear after detach + resync (documented cost)", () => {
    fc.assert(
      fc.property(arbLinkedItemScenario(), fc.boolean(), arbBankEdit, (scn, edit, bankEdit) => {
        load(scn);
        const bankId = raw(scn).link!.bankId;
        const entry = entryOf(bankId);
        fc.pre(entry.bullets.length > 0);
        const hiddenId = entry.bullets[0].id;

        // Pre-state: the overlay hides a bullet of the entry (not a wording edit: stays linked).
        s().updateItem(scn.sectionId, scn.itemId, { hiddenBulletIds: [hiddenId] });
        expect(linkState(raw(scn))).toBe("linked");
        expect(
          resolveItem(raw(scn), bankMap()).bullets.some((b) => b.id === hiddenId)
        ).toBe(false);

        s().detachItem(scn.sectionId, scn.itemId);
        expect(raw(scn).bullets.find((b) => b.id === hiddenId)?.hidden).toBe(true);
        if (edit) s().updateItem(scn.sectionId, scn.itemId, { heading: "local edit" });
        if (bankEdit) editBank(bankId, bankEdit);

        s().resyncItem(scn.sectionId, scn.itemId);

        const after = raw(scn);
        expect("hiddenBulletIds" in after).toBe(false);
        const resolved = resolveItem(after, bankMap());
        expect(resolved.bullets.some((b) => b.id === hiddenId)).toBe(true);
        expectResolvesToEntry(after, entryOf(bankId));
        expect(resolved.bullets).toHaveLength(entryOf(bankId).bullets.length);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("resync on a still-linked item is a no-op with no toast", () => {
    fc.assert(
      fc.property(arbLinkedItemScenario(), (scn) => {
        load(scn);
        const variants = s().variants;
        const bank = s().bank;
        s().resyncItem(scn.sectionId, scn.itemId);
        expect(s().variants).toBe(variants);
        expect(s().bank).toBe(bank);
        expect(toasts()).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("resync on a local item is a no-op with no toast", () => {
    fc.assert(
      fc.property(arbLinkedItemScenario(), (scn) => {
        load(scn);
        // Make the target local by orphaning it: deleting its entry localises every reference.
        const bankId = raw(scn).link!.bankId;
        s().deleteBankItem(bankId);
        expect(linkState(raw(scn))).toBe("local");
        useUiStore.setState({ toasts: [] });
        const variants = s().variants;
        const bank = s().bank;
        s().resyncItem(scn.sectionId, scn.itemId);
        expect(s().variants).toBe(variants);
        expect(s().bank).toBe(bank);
        expect(toasts()).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
