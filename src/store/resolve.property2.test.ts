import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { linkState, resolveItem, resolveResume } from "./resolve";
import {
  arbBank,
  arbBankItem,
  arbDetachedItem,
  arbLocalItem,
  arbUnlinkedItem,
  arbUnlinkedResumeAndBank,
} from "./resolveArbitraries";
import type { BankItem } from "./schema";

/**
 * Feature: item-bank-and-editor-ux, Property 2: Resolution is the identity on
 * local and detached items
 *
 * For any item with no `link`, or with `link.detached === true`, resolving it
 * returns content deep-equal to the item's own fields, so every pre-existing
 * variant renders exactly as it does today. The resolver goes further than the
 * property demands: it returns the very same object (reference identity), and
 * `resolveResume` returns the very same variant when it holds only such items.
 * This holds for any bank, including an empty one and one whose entry for the
 * referenced id carries different wording.
 *
 * **Validates: Requirements 6.2, 7.6, 10.5**
 */

const NUM_RUNS = 200;

const toMap = (bank: readonly BankItem[]) => new Map(bank.map((b) => [b.id, b]));

describe("Property 2: resolution is the identity on local and detached items", () => {
  it("resolveItem returns the same object for a local item, against any bank", () => {
    fc.assert(
      fc.property(arbLocalItem, arbBank(), (item, bank) => {
        const before = structuredClone(item);
        const resolved = resolveItem(item, toMap(bank));
        expect(linkState(item)).toBe("local");
        expect(resolved).toBe(item);
        expect(resolved).toStrictEqual(before);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("resolveItem returns the same object for a detached item, against any bank", () => {
    fc.assert(
      fc.property(
        arbBank().chain((bank) =>
          fc.tuple(arbDetachedItem(bank, 0.3), fc.constant(bank))
        ),
        ([item, bank]) => {
          const before = structuredClone(item);
          const resolved = resolveItem(item, toMap(bank));
          expect(linkState(item)).toBe("detached");
          expect(resolved).toBe(item);
          expect(resolved).toStrictEqual(before);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("holds against an empty bank and against a bank entry with the same id but different wording", () => {
    fc.assert(
      fc.property(
        arbDetachedItem([], 1),
        arbBankItem,
        (item, entry) => {
          const before = structuredClone(item);
          const sameId: BankItem = {
            ...entry,
            id: item.link!.bankId,
            heading: `${entry.heading ?? ""}-bank`,
            bullets: [{ id: "bank-only", text: "bank wording" }, ...entry.bullets],
          };
          for (const bank of [[], [sameId]]) {
            const resolved = resolveItem(item, toMap(bank));
            expect(resolved).toBe(item);
            expect(resolved).toStrictEqual(before);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("resolveResume returns the same variant object when it holds only local/detached items", () => {
    fc.assert(
      fc.property(arbUnlinkedResumeAndBank(), ({ resume, bank }) => {
        const before = structuredClone(resume);
        const resolved = resolveResume(resume, bank);
        expect(resolved).toBe(resume);
        expect(resolved).toStrictEqual(before);
        // Sections and items keep their identity too.
        resume.sections.forEach((s, i) => {
          expect(resolved.sections[i]).toBe(s);
          s.items.forEach((it, j) => expect(resolved.sections[i].items[j]).toBe(it));
        });
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("resolveResume is the identity for any bank, not just the one generated alongside", () => {
    fc.assert(
      fc.property(
        arbBank().chain((bank) =>
          fc.tuple(fc.array(arbUnlinkedItem(bank, 0.3), { maxLength: 4 }), fc.constant(bank))
        ),
        arbBank(),
        ([items, bank], otherBank) => {
          const variant = {
            schemaVersion: 3 as const,
            id: "r",
            name: "r",
            updatedAt: "",
            header: { fullName: "", fields: [] },
            sections: [{ id: "s", kind: "custom" as const, title: "", items }],
          };
          expect(resolveResume(variant, bank)).toBe(variant);
          expect(resolveResume(variant, otherBank)).toBe(variant);
          expect(resolveResume(variant, [])).toBe(variant);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
