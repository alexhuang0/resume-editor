import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { findRawItem } from "./findRawItem";
import { linkState, resolveItem } from "./resolve";
import {
  arbDetachedItemScenario,
  arbLinkedItemScenario,
  arbLocalItemScenario,
} from "./resolveArbitraries";
import type { ItemScenario } from "./resolveArbitraries";
import { useResumeStore } from "./resumeStore";
import type { BankItem, Item, Resume } from "./schema";
import { useUiStore } from "./uiStore";

/**
 * Feature: item-bank-and-editor-ux, Property 12: Content-moving actions preserve
 * what the user sees
 *
 * For any item and any of `detachItem`, `pushItemToBank`, `promoteItemToBank`,
 * or `forkItemToNewBankItem`, the visible projection of the resolved view after
 * the action (the four content fields plus the bullets with `hidden` filtered
 * out, which is exactly what `ResumePreview` and `toMarkdown` render) is
 * deep-equal to the visible projection before it, and the resulting link state
 * is the one that action promises. After push, promote and fork the raw
 * resolved items are deep-equal too; `detachItem` is the one exception and
 * deliberately so: it bakes `hiddenBulletIds` into `bullet.hidden` rather than
 * dropping those bullets (design §4.3), which changes the array while leaving
 * the rendered page identical.
 *
 * Runs against the real store: each iteration loads a generated bank and two
 * variants, applies the action(s) to the target item in the current variant,
 * and compares the visible projection of the RESOLVED item (resolved against the
 * bank current at that moment) before and after. The projection is computed here
 * independently of the store.
 *
 * **Validates: Requirements 7.3, 7.5**
 */

const NUM_RUNS = 150;

// --- projection --------------------------------------------------------------

/** What the page shows for an item: wording plus the non-hidden bullets. */
function projection(item: Item) {
  return {
    heading: item.heading,
    subheading: item.subheading,
    location: item.location,
    dateRange: item.dateRange,
    bullets: item.bullets.filter((b) => !b.hidden).map((b) => ({ id: b.id, text: b.text })),
  };
}

// --- store helpers -----------------------------------------------------------

const s = () => useResumeStore.getState();
const current = (): Resume => s().variants.find((v) => v.id === s().currentVariantId)!;
const raw = (scn: ItemScenario): Item => findRawItem(current(), scn.sectionId, scn.itemId)!;
const sectionKind = (scn: ItemScenario) =>
  current().sections.find((sec) => sec.id === scn.sectionId)!.kind;
const bankMap = () => new Map(s().bank.map((b) => [b.id, b]));
/** The resolved item the user sees, against the bank as it is right now. */
const seen = (scn: ItemScenario): Item => resolveItem(raw(scn), bankMap());
const entryOf = (bankId: string): BankItem | undefined => s().bank.find((b) => b.id === bankId);

function load(scn: ItemScenario) {
  useUiStore.setState({ toasts: [] });
  useResumeStore.setState({
    variants: scn.variants,
    currentVariantId: scn.currentVariantId,
    bank: scn.bank,
  });
}

/** True when `item` has no content of its own (what the store keeps for a linked item). */
function expectNoLocalContent(item: Item) {
  expect(item.bullets).toStrictEqual([]);
  for (const key of ["heading", "subheading", "location", "dateRange"] as const) {
    expect(key in item).toBe(false);
  }
  expect("hiddenBulletIds" in item).toBe(false);
  expect("bulletOrder" in item).toBe(false);
}

/** Bank entries other than `exceptId` are the same objects as before. */
function expectOtherEntriesUntouched(before: readonly BankItem[], exceptId?: string) {
  for (const old of before) {
    if (old.id === exceptId) continue;
    expect(entryOf(old.id)).toBe(old);
  }
}

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
});

describe("Property 12: content-moving actions preserve what the user sees", () => {
  it("detachItem: same projection, overlay-hidden bullets kept but flagged hidden, bank untouched", () => {
    fc.assert(
      fc.property(arbLinkedItemScenario(), (scn) => {
        load(scn);
        const before = raw(scn);
        const entry = entryOf(before.link!.bankId)!;
        const bankBefore = s().bank;
        const projBefore = projection(seen(scn));

        s().detachItem(scn.sectionId, scn.itemId);

        const after = raw(scn);
        expect(linkState(after)).toBe("detached");
        expect(after.link).toStrictEqual({ bankId: entry.id, detached: true });
        expect(projection(seen(scn))).toStrictEqual(projBefore);

        // Overlay-hidden bullets are present, flagged hidden (not dropped).
        const overlayHidden = new Set(before.hiddenBulletIds ?? []);
        expect(after.bullets.map((b) => b.id).sort()).toStrictEqual(
          entry.bullets.map((b) => b.id).sort()
        );
        for (const b of entry.bullets) {
          const kept = after.bullets.find((x) => x.id === b.id)!;
          expect(kept.text).toBe(b.text);
          if (overlayHidden.has(b.id)) expect(kept.hidden).toBe(true);
          else expect(kept.hidden).toBe(b.hidden);
        }
        expect("hiddenBulletIds" in after).toBe(false);
        expect("bulletOrder" in after).toBe(false);

        // The bank is not touched.
        expect(s().bank).toBe(bankBefore);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("pushItemToBank: same projection, entry takes the local wording, other links see it", () => {
    fc.assert(
      fc.property(arbDetachedItemScenario(), (scn) => {
        load(scn);
        const before = raw(scn);
        const bankId = before.link!.bankId;
        const bankBefore = s().bank;
        const entryBefore = entryOf(bankId)!;
        const projBefore = projection(seen(scn));

        // Everything else linked to the same entry, in any variant.
        const siblings: { variantId: string; sectionId: string; item: Item }[] = [];
        for (const v of s().variants) {
          for (const sec of v.sections) {
            for (const i of sec.items) {
              const isTarget =
                v.id === scn.currentVariantId && sec.id === scn.sectionId && i.id === scn.itemId;
              if (!isTarget && i.link?.bankId === bankId && !i.link.detached) {
                siblings.push({ variantId: v.id, sectionId: sec.id, item: i });
              }
            }
          }
        }
        const otherVariants = s().variants.filter((v) => v.id !== scn.currentVariantId);

        expect(s().pushItemToBank(scn.sectionId, scn.itemId)).toBe(true);

        const after = raw(scn);
        expect(linkState(after)).toBe("linked");
        expect(after.link).toStrictEqual({ bankId });
        expectNoLocalContent(after);
        expect(projection(seen(scn))).toStrictEqual(projBefore);

        // The entry now holds the local wording; hidden flags kept; bullets deep-copied.
        const entry = entryOf(bankId)!;
        expect(entry.id).toBe(bankId);
        expect(entry.kind).toBe(entryBefore.kind);
        expect(entry.label).toBe(entryBefore.label);
        for (const key of ["heading", "subheading", "location", "dateRange"] as const) {
          expect(entry[key]).toBe(before[key]);
        }
        expect(entry.bullets).toStrictEqual(before.bullets);
        entry.bullets.forEach((b, i) => expect(b).not.toBe(before.bullets[i]));
        expectOtherEntriesUntouched(bankBefore, bankId);
        expect(s().bank).toHaveLength(bankBefore.length);

        // Intended cross-variant effect: every other item linked to this entry,
        // here or in another variant, now resolves to the pushed wording.
        for (const { variantId, sectionId, item } of siblings) {
          const variant = s().variants.find((v) => v.id === variantId)!;
          expect(findRawItem(variant, sectionId, item.id)).toBe(item); // raw item untouched
          const resolved = resolveItem(item, bankMap());
          for (const key of ["heading", "subheading", "location", "dateRange"] as const) {
            expect(resolved[key]).toBe(before[key]);
          }
          const localIds = new Set(before.bullets.map((b) => b.id));
          for (const b of resolved.bullets) expect(localIds.has(b.id)).toBe(true);
        }
        s().variants
          .filter((v) => v.id !== scn.currentVariantId)
          .forEach((v, i) => expect(v).toBe(otherVariants[i]));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("promoteItemToBank: same projection, new entry of the section's kind holds the bullets with ids kept", () => {
    fc.assert(
      fc.property(arbLocalItemScenario(), (scn) => {
        load(scn);
        const before = raw(scn);
        const bankBefore = s().bank;
        const kind = sectionKind(scn);
        const projBefore = projection(seen(scn));
        expect(linkState(before)).toBe("local");

        const newId = s().promoteItemToBank(scn.sectionId, scn.itemId);

        expect(newId).toBeTruthy();
        const after = raw(scn);
        expect(linkState(after)).toBe("linked");
        expect(after.link).toStrictEqual({ bankId: newId });
        expectNoLocalContent(after);
        expect(projection(seen(scn))).toStrictEqual(projBefore);

        // One new entry; the old ones are untouched.
        expect(s().bank).toHaveLength(bankBefore.length + 1);
        expect(bankBefore.some((b) => b.id === newId)).toBe(false);
        expectOtherEntriesUntouched(bankBefore);
        const entry = entryOf(newId!)!;
        expect(entry.kind).toBe(kind);
        for (const key of ["heading", "subheading", "location", "dateRange"] as const) {
          expect(entry[key]).toBe(before[key]);
        }
        expect(entry.bullets).toStrictEqual(before.bullets); // ids, text, hidden flags
        entry.bullets.forEach((b, i) => expect(b).not.toBe(before.bullets[i]));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  describe("forkItemToNewBankItem", () => {
    const expectFork = (scn: ItemScenario) => {
      load(scn);
      const before = raw(scn);
      const oldId = before.link!.bankId;
      const original = entryOf(oldId); // undefined for an orphan
      const bankBefore = s().bank;
      const kind = sectionKind(scn);
      const projBefore = projection(seen(scn));

      const newId = s().forkItemToNewBankItem(scn.sectionId, scn.itemId);

      expect(newId).toBeTruthy();
      expect(newId).not.toBe(oldId);
      const after = raw(scn);
      expect(linkState(after)).toBe("linked");
      expect(after.link).toStrictEqual({ bankId: newId });
      expectNoLocalContent(after);
      expect(projection(seen(scn))).toStrictEqual(projBefore);

      // The original entry (if any) is the very same object; one entry added.
      if (original) expect(entryOf(oldId)).toBe(original);
      expectOtherEntriesUntouched(bankBefore);
      expect(s().bank).toHaveLength(bankBefore.length + 1);
      expect(bankBefore.some((b) => b.id === newId)).toBe(false);
      expect(entryOf(newId!)?.kind).toBe(kind);
    };

    it("a detached item (entry present or gone)", () => {
      fc.assert(fc.property(arbDetachedItemScenario(0.3), expectFork), {
        numRuns: NUM_RUNS,
      });
    });

    it("a linked item with an overlay", () => {
      fc.assert(fc.property(arbLinkedItemScenario(), expectFork), { numRuns: NUM_RUNS });
    });
  });

  it("a chain of up to 4 legal actions keeps the projection invariant after every step", () => {
    const arbStart = fc.oneof(
      arbLocalItemScenario(),
      arbDetachedItemScenario(),
      arbLinkedItemScenario()
    );
    // Each pick indexes (modulo) into the actions legal for the current link state.
    const arbPicks = fc.array(fc.nat(), { minLength: 1, maxLength: 4 });
    type Step = "promote" | "detach" | "fork" | "push";
    const legal: Record<ReturnType<typeof linkState>, Step[]> = {
      local: ["promote"],
      linked: ["detach", "fork"],
      detached: ["push", "fork"],
    };

    fc.assert(
      fc.property(arbStart, arbPicks, (scn, picks) => {
        load(scn);
        const projBefore = projection(seen(scn));

        for (const pick of picks) {
          const state = linkState(raw(scn));
          const options = legal[state];
          const step = options[pick % options.length];
          const bankLen = s().bank.length;
          const bankIdBefore = raw(scn).link?.bankId;

          switch (step) {
            case "promote":
              expect(s().promoteItemToBank(scn.sectionId, scn.itemId)).toBeTruthy();
              expect(linkState(raw(scn))).toBe("linked");
              expect(s().bank).toHaveLength(bankLen + 1);
              break;
            case "detach":
              s().detachItem(scn.sectionId, scn.itemId);
              expect(linkState(raw(scn))).toBe("detached");
              expect(raw(scn).link?.bankId).toBe(bankIdBefore);
              expect(s().bank).toHaveLength(bankLen);
              break;
            case "push":
              expect(s().pushItemToBank(scn.sectionId, scn.itemId)).toBe(true);
              expect(linkState(raw(scn))).toBe("linked");
              expect(raw(scn).link?.bankId).toBe(bankIdBefore);
              expect(s().bank).toHaveLength(bankLen);
              break;
            case "fork": {
              const newId = s().forkItemToNewBankItem(scn.sectionId, scn.itemId);
              expect(newId).toBeTruthy();
              expect(linkState(raw(scn))).toBe("linked");
              expect(raw(scn).link?.bankId).toBe(newId);
              expect(newId).not.toBe(bankIdBefore);
              expect(s().bank).toHaveLength(bankLen + 1);
              break;
            }
          }

          expect(projection(seen(scn))).toStrictEqual(projBefore);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
