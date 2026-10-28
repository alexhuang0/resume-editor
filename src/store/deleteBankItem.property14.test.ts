import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { bankItemDisplayLabel } from "./bankLabel";
import { isOrphaned, linkState, resolveItem } from "./resolve";
import { arbDeleteBankItemScenario } from "./resolveArbitraries";
import type { DeleteBankItemScenario } from "./resolveArbitraries";
import { useResumeStore } from "./resumeStore";
import type { BankItem, Item, Resume } from "./schema";
import { useUiStore } from "./uiStore";

/**
 * Feature: item-bank-and-editor-ux, Property 14: Deleting a bank item orphans
 * references and never fails
 *
 * For any library and any bank entry, including entries referenced by zero, one,
 * or many variant items, deleting the entry succeeds, and every referencing item
 * becomes local while resolving to the same content it resolved to immediately
 * before the delete.
 *
 * Runs against the real store: each iteration loads a generated library (1–3
 * variants; the target entry referenced 0, 1 or many times, linked with overlays
 * and detached, among decoys), deletes the entry, and checks the visible
 * projection of every referencing item (computed here independently of the
 * store), structural sharing of everything untouched, the toast, and that the
 * toast's undo restores the exact pre-delete library.
 *
 * **Validates: Requirements 7.7**
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

// --- helpers -----------------------------------------------------------------

const s = () => useResumeStore.getState();
const toasts = () => useUiStore.getState().toasts;

function load(scn: DeleteBankItemScenario) {
  useUiStore.setState({ toasts: [] });
  useResumeStore.setState({
    variants: scn.variants,
    currentVariantId: scn.currentVariantId,
    bank: scn.bank,
  });
}

interface Ref {
  variantIndex: number;
  sectionIndex: number;
  itemIndex: number;
  before: Item;
  /** Projection of the item resolved against the bank BEFORE the delete. */
  seenBefore: ReturnType<typeof projection>;
}

/** Every item (any variant, any section) whose link names `id`, with its pre-delete view. */
function referencesTo(variants: readonly Resume[], bank: readonly BankItem[], id: string): Ref[] {
  const bankById = new Map(bank.map((b) => [b.id, b]));
  const refs: Ref[] = [];
  variants.forEach((v, variantIndex) =>
    v.sections.forEach((sec, sectionIndex) =>
      sec.items.forEach((before, itemIndex) => {
        if (before.link?.bankId !== id) return;
        refs.push({
          variantIndex,
          sectionIndex,
          itemIndex,
          before,
          seenBefore: projection(resolveItem(before, bankById)),
        });
      })
    )
  );
  return refs;
}

/** Variants with `updatedAt` stripped, for comparing a library across an undo. */
const withoutUpdatedAt = (variants: readonly Resume[]) =>
  variants.map(({ updatedAt: _u, ...rest }) => rest);

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
});

describe("Property 14: deleting a bank item orphans references and never fails", () => {
  it("a known entry: succeeds, orphans every reference without changing what it shows, and undoes exactly", () => {
    fc.assert(
      fc.property(arbDeleteBankItemScenario(), (scn) => {
        load(scn);
        const { targetId } = scn;
        const variantsBefore = s().variants;
        const bankBefore = s().bank;
        const index = bankBefore.findIndex((b) => b.id === targetId);
        const entry = bankBefore[index];
        const refs = referencesTo(variantsBefore, bankBefore, targetId);
        expect(refs).toHaveLength(scn.refCount);

        // (a) never throws; returns the removed entry; bank loses only that entry.
        let removed: BankItem | null = null;
        expect(() => {
          removed = s().deleteBankItem(targetId);
        }).not.toThrow();
        expect(removed).toBe(entry);
        const bankAfter = s().bank;
        expect(bankAfter).toHaveLength(bankBefore.length - 1);
        expect(bankAfter.some((b) => b.id === targetId)).toBe(false);
        bankAfter.forEach((b, i) => expect(b).toBe(bankBefore.filter((x) => x !== entry)[i]));

        const variantsAfter = s().variants;
        expect(variantsAfter).toHaveLength(variantsBefore.length);
        const touchedVariants = new Set(refs.map((r) => r.variantIndex));
        const touchedSections = new Set(refs.map((r) => `${r.variantIndex}/${r.sectionIndex}`));
        const touchedItems = new Set(
          refs.map((r) => `${r.variantIndex}/${r.sectionIndex}/${r.itemIndex}`)
        );

        // (b), (c), (g) every reference is now local, shows the same, keeps/bakes content.
        for (const r of refs) {
          const after =
            variantsAfter[r.variantIndex].sections[r.sectionIndex].items[r.itemIndex];
          const { before } = r;

          expect("link" in after).toBe(false);
          expect("hiddenBulletIds" in after).toBe(false);
          expect("bulletOrder" in after).toBe(false);
          expect(linkState(after)).toBe("local");
          expect(isOrphaned(after, bankAfter)).toBe(false);
          expect(after.id).toBe(before.id);
          expect(after.hidden).toBe(before.hidden);

          // Local items resolve to themselves; the page shows the same thing.
          const resolvedAfter = resolveItem(after, new Map(bankAfter.map((b) => [b.id, b])));
          expect(resolvedAfter).toBe(after);
          expect(projection(resolvedAfter)).toStrictEqual(r.seenBefore);

          if (before.link!.detached) {
            // Detached: own content byte-for-byte, only `link` dropped.
            const { link: _link, ...rest } = before;
            expect(after).toStrictEqual(rest);
          } else {
            // Linked: bank wording baked in; overlay-hidden bullets kept but flagged hidden.
            expect(after.heading).toBe(entry.heading);
            expect(after.subheading).toBe(entry.subheading);
            expect(after.location).toBe(entry.location);
            expect(after.dateRange).toBe(entry.dateRange);
            const hiddenIds = new Set(before.hiddenBulletIds ?? []);
            expect(after.bullets.map((b) => b.id).sort()).toStrictEqual(
              entry.bullets.map((b) => b.id).sort()
            );
            for (const eb of entry.bullets) {
              const baked = after.bullets.find((b) => b.id === eb.id)!;
              expect(baked).toStrictEqual(hiddenIds.has(eb.id) ? { ...eb, hidden: true } : eb);
            }
          }
        }

        // (d) everything not referencing the entry is the very same object.
        variantsBefore.forEach((vb, vi) => {
          const va = variantsAfter[vi];
          if (!touchedVariants.has(vi)) {
            expect(va).toBe(vb);
            return;
          }
          expect(va.id).toBe(vb.id);
          expect(Number.isNaN(Date.parse(va.updatedAt))).toBe(false);
          expect(va.updatedAt).not.toBe(vb.updatedAt);
          expect(va.sections).toHaveLength(vb.sections.length);
          vb.sections.forEach((sb, si) => {
            const sa = va.sections[si];
            if (!touchedSections.has(`${vi}/${si}`)) {
              expect(sa).toBe(sb);
              return;
            }
            expect(sa.items).toHaveLength(sb.items.length);
            sb.items.forEach((ib, ii) => {
              if (!touchedItems.has(`${vi}/${si}/${ii}`)) expect(sa.items[ii]).toBe(ib);
            });
          });
        });

        // (g) nothing anywhere still points at the deleted entry.
        for (const v of variantsAfter) {
          for (const sec of v.sections) {
            for (const item of sec.items) expect(item.link?.bankId).not.toBe(targetId);
          }
        }

        // (e) the variants array is untouched for zero references; the toast says how many.
        if (refs.length === 0) expect(variantsAfter).toBe(variantsBefore);
        const n = refs.length;
        const label = bankItemDisplayLabel(entry);
        expect(toasts()).toHaveLength(1);
        expect(typeof toasts()[0].undo).toBe("function");
        expect(toasts()[0].message).toBe(
          n === 0
            ? `Bank entry "${label}" deleted`
            : `Bank entry "${label}" deleted — ${n} ${n === 1 ? "item" : "items"} kept as local copies`
        );

        // (f) undo: entry back at its original index, items back to their raw snapshots.
        toasts()[0].undo!();
        expect(s().bank).toHaveLength(bankBefore.length);
        expect(s().bank[index]).toBe(entry);
        expect(s().bank).toStrictEqual(bankBefore);
        const variantsUndone = s().variants;
        for (const r of refs) {
          expect(
            variantsUndone[r.variantIndex].sections[r.sectionIndex].items[r.itemIndex]
          ).toStrictEqual(r.before);
        }
        expect(withoutUpdatedAt(variantsUndone)).toStrictEqual(withoutUpdatedAt(variantsBefore));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("an unknown id: returns null, changes nothing, pushes no toast", () => {
    fc.assert(
      fc.property(arbDeleteBankItemScenario(), (scn) => {
        load(scn);
        const variantsBefore = s().variants;
        const bankBefore = s().bank;

        let removed: BankItem | null | undefined;
        expect(() => {
          removed = s().deleteBankItem("nope-id");
        }).not.toThrow();

        expect(removed).toBeNull();
        expect(s().variants).toBe(variantsBefore);
        expect(s().bank).toBe(bankBefore);
        expect(toasts()).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("generator covers zero, one and many references", () => {
    const counts = new Set<string>();
    fc.assert(
      fc.property(arbDeleteBankItemScenario(), (scn) => {
        counts.add(scn.refCount === 0 ? "zero" : scn.refCount === 1 ? "one" : "many");
      }),
      { numRuns: NUM_RUNS }
    );
    expect([...counts].sort()).toStrictEqual(["many", "one", "zero"]);
  });
});
