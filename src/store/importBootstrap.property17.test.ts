import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { linkState, resolveItem } from "./resolve";
import { arbBank, arbItem, arbResume } from "./resolveArbitraries";
import { projectItemsToImport } from "./importProjection";
import { useResumeStore } from "./resumeStore";
import type { BankItem, Item, Resume } from "./schema";

/**
 * Feature: item-bank-and-editor-ux, Property 17: Bank bootstrap is idempotent
 *
 * For any variant and any subset of its sections, running the bootstrap
 * projection, applying it with `importItemsToBank`, and running it again
 * proposes an empty second batch and leaves the bank unchanged.
 *
 * Runs against the REAL store and the REAL pure projection (no mocks). Each
 * iteration seeds a fresh library (one target variant whose items mix local,
 * linked and detached states, resolving against a generated bank) and a subset
 * of its section ids, then asserts:
 *   (1) idempotence — the first apply returns one id per projected entry, and a
 *       second projection/apply is empty with the bank unchanged;
 *   (2) the local items in the selected sections are now linked and have real
 *       bank entries, while already-linked/detached items and every
 *       non-selected section are untouched;
 *   (3) rendering is preserved — the resolved, hidden-filtered view of each
 *       promoted item is unchanged by the promotion.
 *
 * **Validates: Requirements 11.1, 11.2**
 */

const NUM_RUNS = 150;
const VARIANT_ID = "variant-a";

interface BootstrapScenario {
  bank: BankItem[];
  variant: Resume;
  /** Section ids chosen for import: a subset of the variant's, plus stray ids. */
  sectionIds: string[];
}

/**
 * A target variant (fixed id) with items in all three link states, plus a
 * generated bank its links resolve against (danglingRate 0, so every link
 * renders to real wording and promotion can be compared for rendering). The
 * selection is an arbitrary subset of the variant's section ids with occasional
 * stray ids the projection must ignore.
 */
function arbBootstrapScenario(): fc.Arbitrary<BootstrapScenario> {
  return arbBank().chain((bank) =>
    arbResume(arbItem(bank, 0)).chain((resume) => {
      const variant: Resume = { ...resume, id: VARIANT_ID };
      const realIds = variant.sections.map((s) => s.id);
      const choices = realIds.length
        ? fc.subarray(realIds)
        : fc.constant<string[]>([]);
      return fc
        .tuple(choices, fc.array(fc.constantFrom("stray-1", "stray-2"), { maxLength: 2 }))
        .map(([picked, stray]) => ({ bank, variant, sectionIds: [...picked, ...stray] }));
    })
  );
}

const s = () => useResumeStore.getState();

function load(scn: BootstrapScenario) {
  useResumeStore.setState({
    variants: [scn.variant],
    currentVariantId: VARIANT_ID,
    bank: scn.bank,
  });
}

/** The hidden-filtered, resolved projection the page would render for an item. */
function rendered(item: Item, bank: readonly BankItem[]) {
  const resolved = resolveItem(item, new Map(bank.map((b) => [b.id, b])));
  return {
    heading: resolved.heading,
    subheading: resolved.subheading,
    location: resolved.location,
    dateRange: resolved.dateRange,
    bullets: resolved.bullets.filter((b) => !b.hidden).map((b) => ({ id: b.id, text: b.text })),
  };
}

/** The (sectionId,itemId) pairs that live inside the SELECTED sections. */
function selectedPairs(variant: Resume, sectionIds: string[]) {
  const selected = new Set(sectionIds);
  const pairs: { sectionId: string; itemId: string; item: Item }[] = [];
  for (const section of variant.sections) {
    if (!selected.has(section.id)) continue;
    for (const item of section.items) pairs.push({ sectionId: section.id, itemId: item.id, item });
  }
  return pairs;
}

beforeEach(() => {
  // Fresh store every iteration: no cross-run bleed from prior seeds.
  useResumeStore.setState({ variants: [], bank: [], currentVariantId: VARIANT_ID });
});

describe("Feature: item-bank-and-editor-ux, Property 17: bank bootstrap is idempotent", () => {
  it("first apply promotes exactly the projection; a second run proposes nothing and leaves the bank unchanged", () => {
    fc.assert(
      fc.property(arbBootstrapScenario(), (scn) => {
        load(scn);

        const variantBefore = s().variants.find((v) => v.id === VARIANT_ID)!;
        const bankBefore = s().bank;

        // Pre-apply render view of every item in the selected sections.
        const beforePairs = selectedPairs(variantBefore, scn.sectionIds);
        const renderedBefore = new Map(
          beforePairs.map((p) => [`${p.sectionId}\u0000${p.itemId}`, rendered(p.item, bankBefore)])
        );
        const stateBefore = new Map(
          beforePairs.map((p) => [`${p.sectionId}\u0000${p.itemId}`, linkState(p.item)])
        );

        // --- the projection and the first apply agree on the set ---
        const firstProjection = projectItemsToImport(variantBefore, scn.sectionIds);
        const createdIds = s().importItemsToBank(VARIANT_ID, scn.sectionIds);

        // (1a) one created id per projected entry.
        expect(createdIds).toHaveLength(firstProjection.length);
        // Every projected entry was a local item.
        for (const entry of firstProjection) {
          expect(stateBefore.get(`${entry.sectionId}\u0000${entry.itemId}`)).toBe("local");
        }

        const variantAfter = s().variants.find((v) => v.id === VARIANT_ID)!;
        const bankAfter = s().bank;

        // Bank grew by exactly the created entries, and they exist.
        expect(bankAfter).toHaveLength(bankBefore.length + createdIds.length);
        for (const id of createdIds) expect(bankAfter.some((b) => b.id === id)).toBe(true);

        // (2) every item in the selected sections, examined after apply.
        const afterPairs = selectedPairs(variantAfter, scn.sectionIds);
        const promotedKeys = new Set(
          firstProjection.map((e) => `${e.sectionId}\u0000${e.itemId}`)
        );
        for (const p of afterPairs) {
          const key = `${p.sectionId}\u0000${p.itemId}`;
          const wasState = stateBefore.get(key)!;
          if (promotedKeys.has(key)) {
            // Was local, now linked (not detached) to a real, new entry.
            expect(wasState).toBe("local");
            expect(linkState(p.item)).toBe("linked");
            expect(p.item.link).toBeDefined();
            expect(p.item.link!.detached).toBeFalsy();
            expect(bankAfter.some((b) => b.id === p.item.link!.bankId)).toBe(true);
          } else {
            // Already linked or detached: link state unchanged.
            expect(wasState).not.toBe("local");
            expect(linkState(p.item)).toBe(wasState);
          }
          // (3) rendering preserved across the promotion.
          expect(rendered(p.item, bankAfter)).toStrictEqual(renderedBefore.get(key));
        }

        // Non-selected sections are the very same objects (structural sharing).
        const selectedSet = new Set(scn.sectionIds);
        for (const secBefore of variantBefore.sections) {
          if (selectedSet.has(secBefore.id)) continue;
          const secAfter = variantAfter.sections.find((x) => x.id === secBefore.id)!;
          expect(secAfter).toBe(secBefore);
        }

        // --- (1b) idempotence: second projection and second apply are empty ---
        const secondProjection = projectItemsToImport(variantAfter, scn.sectionIds);
        expect(secondProjection).toHaveLength(0);

        const bankBeforeSecond = s().bank;
        const createdAgain = s().importItemsToBank(VARIANT_ID, scn.sectionIds);
        expect(createdAgain).toHaveLength(0);
        // Bank unchanged: same array reference, no new entries.
        expect(s().bank).toBe(bankBeforeSecond);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("generator exercises empty, partial, and full section selections", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(arbBootstrapScenario(), (scn) => {
        const real = scn.variant.sections.map((x) => x.id);
        const pickedReal = scn.sectionIds.filter((id) => real.includes(id));
        if (pickedReal.length === 0) seen.add("none");
        else if (pickedReal.length === real.length) seen.add("all");
        else seen.add("some");
      }),
      { numRuns: NUM_RUNS }
    );
    // At minimum we want some non-trivial coverage of the selection space.
    expect(seen.has("none")).toBe(true);
    expect(seen.has("all")).toBe(true);
  });
});
