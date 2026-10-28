import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { linkState, resolveItem, resolveResume, type ResolvedItem } from "./resolve";
import { arbBank, arbResumeAndBank } from "./resolveArbitraries";
import { ResumeSchema, type BankItem, type Resume } from "./schema";

const NUM_RUNS = 200;

/** A random permutation of `bank` (same entries, any order). */
const arbShuffled = (bank: BankItem[]): fc.Arbitrary<BankItem[]> =>
  fc
    .shuffledSubarray(bank, { minLength: bank.length, maxLength: bank.length })
    .map((entries) => [...entries]);

/**
 * A bank to resolve against, derived from the one the resume was generated
 * for. Covers the adversarial shapes: unchanged, empty, shuffled, entries with
 * duplicate-looking content under other ids, repeated ids (last wins), and an
 * unrelated bank.
 */
function arbBankVariant(bank: BankItem[]): fc.Arbitrary<BankItem[]> {
  const sameContentOtherIds: BankItem[] = [
    ...bank,
    ...bank.map((b, i) => ({ ...structuredClone(b), id: `bank-copy-${i}` })),
  ];
  const repeatedIds: BankItem[] = [
    ...bank,
    ...bank.map((b) => ({ ...structuredClone(b), heading: "duplicate id", bullets: [] })),
  ];
  const options: fc.Arbitrary<BankItem[]>[] = [
    fc.constant(bank),
    fc.constant<BankItem[]>([]),
    arbShuffled(bank),
    fc.constant(sameContentOtherIds),
    fc.constant(repeatedIds),
    arbBank().map((b) => [...b]),
  ];
  return fc.oneof(...options);
}

const arbResumeAndAnyBank = fc
  .oneof(
    arbResumeAndBank(),
    arbResumeAndBank({ danglingRate: 0 }),
    arbResumeAndBank({ danglingRate: 1 })
  )
  .chain(({ resume, bank }) =>
    arbBankVariant(bank).map((resolveBank) => ({ resume, bank: resolveBank }))
  );

/**
 * Feature: item-bank-and-editor-ux, Property 6: Resolution is pure and total
 *
 * For any variant and bank, including links whose `bankId` is absent from the
 * bank, resolution returns without throwing, produces deep-equal results on
 * repeated calls, and leaves both the variant and the bank unmutated — which is
 * what makes memoizing it safe. A dangling linked item resolves to its own
 * (empty) fields flagged `orphaned: true`.
 *
 * **Validates: Requirements 6.3, 6.6**
 */
describe("Property 6: resolution is pure and total", () => {
  it("never throws, never mutates, is deterministic, and orphans dangling links", () => {
    fc.assert(
      fc.property(arbResumeAndAnyBank, ({ resume, bank }) => {
        const resumeBefore = structuredClone(resume);
        const bankBefore = structuredClone(bank);

        let resolved!: Resume;
        expect(() => {
          resolved = resolveResume(resume, bank);
        }).not.toThrow();

        // No mutation of either input.
        expect(resume).toStrictEqual(resumeBefore);
        expect(bank).toStrictEqual(bankBefore);

        // Deterministic.
        expect(resolveResume(resume, bank)).toStrictEqual(resolved);
        expect(resume).toStrictEqual(resumeBefore);
        expect(bank).toStrictEqual(bankBefore);

        // Dangling linked items fall back to their own fields, flagged; nothing else is flagged.
        const ids = new Set(bank.map((b) => b.id));
        resume.sections.forEach((section, si) => {
          section.items.forEach((item, ii) => {
            const out = resolved.sections[si].items[ii] as ResolvedItem;
            const dangling = linkState(item) === "linked" && !ids.has(item.link!.bankId);
            if (dangling) {
              expect(out.orphaned).toBe(true);
              expect({ ...out, orphaned: undefined }).toStrictEqual({ ...item, orphaned: undefined });
              expect(out.bullets).toStrictEqual(item.bullets);
            } else {
              expect(out.orphaned).toBeUndefined();
            }
          });
        });
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("gives the same result whatever order the bank is in", () => {
    fc.assert(
      fc.property(
        arbResumeAndBank().chain(({ resume, bank }) =>
          fc.tuple(fc.constant(resume), fc.constant(bank), arbShuffled(bank))
        ),
        ([resume, bank, shuffled]) => {
          expect(resolveResume(resume, shuffled)).toStrictEqual(resolveResume(resume, bank));
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("resolveItem is total over an empty bank map", () => {
    fc.assert(
      fc.property(arbResumeAndBank({ danglingRate: 1 }), ({ resume }) => {
        for (const section of resume.sections) {
          for (const item of section.items) {
            const before = structuredClone(item);
            expect(() => resolveItem(item, new Map())).not.toThrow();
            expect(item).toStrictEqual(before);
          }
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("does not throw for a variant with only dangling links and an empty bank", () => {
    const resume: Resume = {
      schemaVersion: 3,
      id: "v",
      name: "v",
      updatedAt: "",
      header: { fullName: "", fields: [] },
      sections: [
        {
          id: "sec-0",
          kind: "experience",
          title: "Experience",
          items: [
            {
              id: "item-0",
              bullets: [],
              link: { bankId: "missing-0" },
              hiddenBulletIds: ["x"],
              bulletOrder: ["y", "y"],
            },
            { id: "item-1", bullets: [], link: { bankId: "missing-1", detached: false } },
          ],
        },
      ],
    };
    let out!: Resume;
    expect(() => {
      out = resolveResume(resume, []);
    }).not.toThrow();
    for (const item of out.sections[0].items as ResolvedItem[]) {
      expect(item.orphaned).toBe(true);
      expect(item.bullets).toStrictEqual([]);
    }
  });
});

/**
 * Feature: item-bank-and-editor-ux, Property 7: A resolved resume is always a
 * valid Resume
 *
 * For any variant and bank, the resolved resume parses successfully against
 * `ResumeSchema`, so the preview, Markdown export, and JSON export can consume
 * it unchanged. The runtime-only `orphaned` flag is stripped by the parse;
 * `link`, `hiddenBulletIds` and `bulletOrder` survive it.
 *
 * **Validates: Requirements 6.5**
 */
describe("Property 7: a resolved resume is always a valid Resume", () => {
  it("parses against ResumeSchema with structure, ids and link metadata intact", () => {
    fc.assert(
      fc.property(arbResumeAndAnyBank, ({ resume, bank }) => {
        // Precondition: the generated input is itself a valid v3 resume.
        expect(ResumeSchema.safeParse(resume).success).toBe(true);

        const resolved = resolveResume(resume, bank);
        const result = ResumeSchema.safeParse(resolved);
        expect(result.success).toBe(true);
        if (!result.success) return;
        const parsed = result.data;

        // Same shape as the input: resume-level fields, section and item counts and ids.
        expect(parsed.id).toBe(resume.id);
        expect(parsed.header).toStrictEqual(resume.header);
        expect(parsed.sections.map((s) => s.id)).toStrictEqual(resume.sections.map((s) => s.id));
        expect(parsed.sections.map((s) => s.items.map((i) => i.id))).toStrictEqual(
          resume.sections.map((s) => s.items.map((i) => i.id))
        );

        resolved.sections.forEach((section, si) => {
          section.items.forEach((item, ii) => {
            const original = resume.sections[si].items[ii];
            const kept = parsed.sections[si].items[ii];

            // Every resolved item's bullets are an array of valid bullets.
            expect(Array.isArray(item.bullets)).toBe(true);
            for (const bullet of item.bullets) {
              expect(typeof bullet.id).toBe("string");
              expect(typeof bullet.text).toBe("string");
            }
            expect(kept.bullets).toStrictEqual(item.bullets);

            // Link-carrying fields survive the parse and the resolve.
            expect(kept.link).toStrictEqual(original.link);
            expect(kept.hiddenBulletIds).toStrictEqual(original.hiddenBulletIds);
            expect(kept.bulletOrder).toStrictEqual(original.bulletOrder);
            expect(kept.hidden).toStrictEqual(original.hidden);

            // The inert runtime flag never leaks into the validated shape.
            expect(kept).not.toHaveProperty("orphaned");
          });
        });
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
