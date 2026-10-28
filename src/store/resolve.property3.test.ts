import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { linkState, resolveItem, resolveResume } from "./resolve";
import type { ResolvedItem } from "./resolve";
import {
  arbLinkedItem,
  arbLinkedItemWithStrayContent,
  arbLocalItem,
  arbDetachedItem,
  arbNonEmptyBank,
  arbResume,
} from "./resolveArbitraries";
import type { BankItem, Item } from "./schema";

/**
 * Feature: item-bank-and-editor-ux, Property 3: Linked items take their wording
 * from the bank and keep their link
 *
 * For any bank entry and any item linked to it, the resolved item's `heading`,
 * `subheading`, `location`, `dateRange`, and bullet texts equal the bank
 * entry's, while `id`, `hidden`, `link`, `hiddenBulletIds`, and `bulletOrder`
 * come from the variant item unchanged. Generated linked items also carry stray
 * local wording (heading, bullets) that the resolver must ignore. The overlay's
 * hide/reorder algebra is Property 4; here the resolved bullets are only
 * required to be a subset of the entry's bullets (same id, same content).
 *
 * **Validates: Requirements 5.2, 5.4, 6.1, 6.4**
 */

const NUM_RUNS = 200;

const toMap = (bank: readonly BankItem[]) => new Map(bank.map((b) => [b.id, b]));

/** The Property 3 assertions for one linked item whose entry exists. */
function expectTakesWordingFromBank(item: Item, resolved: ResolvedItem, entry: BankItem) {
  // Identity, visibility and the link come from the variant item, unchanged.
  expect(resolved.id).toBe(item.id);
  expect(resolved.hidden).toBe(item.hidden);
  expect(resolved.link).toStrictEqual(item.link);
  expect(resolved.link?.bankId).toBe(item.link!.bankId);
  expect(resolved.link?.detached).toBe(item.link!.detached);
  // The overlay rides along as stored.
  expect(resolved.hiddenBulletIds).toStrictEqual(item.hiddenBulletIds);
  expect(resolved.bulletOrder).toStrictEqual(item.bulletOrder);
  // Wording is the bank entry's (undefined included), never the item's own.
  expect(resolved.heading).toBe(entry.heading);
  expect(resolved.subheading).toBe(entry.subheading);
  expect(resolved.location).toBe(entry.location);
  expect(resolved.dateRange).toBe(entry.dateRange);
  // Every resolved bullet is a bank bullet (id and content); none of the item's own leak in.
  const bankBullets = new Map(entry.bullets.map((b) => [b.id, b]));
  // (Exactly-once / ordering is Property 4's concern, not asserted here.)
  for (const bullet of resolved.bullets) {
    expect(bankBullets.has(bullet.id)).toBe(true);
    expect(bullet).toStrictEqual(bankBullets.get(bullet.id));
  }
  expect(resolved.orphaned).toBeUndefined();
}

describe("Property 3: linked items take their wording from the bank and keep their link", () => {
  it("resolveItem takes wording from the bank entry and keeps id/hidden/link/overlay", () => {
    fc.assert(
      fc.property(
        arbNonEmptyBank().chain((bank) =>
          fc.tuple(arbLinkedItemWithStrayContent(bank), fc.constant(bank))
        ),
        ([item, bank]) => {
          const itemBefore = structuredClone(item);
          const bankBefore = structuredClone(bank);
          expect(linkState(item)).toBe("linked");

          const resolved = resolveItem(item, toMap(bank));

          expectTakesWordingFromBank(item, resolved, bank.find((b) => b.id === item.link!.bankId)!);
          // Inputs are untouched.
          expect(item).toStrictEqual(itemBefore);
          expect(bank).toStrictEqual(bankBefore);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("ignores stray local wording even when the bank entry has none", () => {
    fc.assert(
      fc.property(
        arbNonEmptyBank().chain((bank) =>
          fc.tuple(arbLinkedItemWithStrayContent(bank), fc.constant(bank))
        ),
        ([item, bank]) => {
          const entry = bank.find((b) => b.id === item.link!.bankId)!;
          const blank: BankItem = {
            ...entry,
            heading: undefined,
            subheading: undefined,
            location: undefined,
            dateRange: undefined,
            bullets: [],
          };
          const resolved = resolveItem(item, toMap([blank]));
          expect(resolved.heading).toBeUndefined();
          expect(resolved.subheading).toBeUndefined();
          expect(resolved.location).toBeUndefined();
          expect(resolved.dateRange).toBeUndefined();
          expect(resolved.bullets).toStrictEqual([]);
          expect(resolved.link).toStrictEqual(item.link);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("resolveResume resolves every linked item with an entry and leaves other items identical", () => {
    fc.assert(
      fc.property(
        arbNonEmptyBank().chain((bank) =>
          fc.tuple(
            arbResume(
              fc.oneof(
                arbLocalItem,
                arbDetachedItem(bank, 0.3),
                arbLinkedItemWithStrayContent(bank),
                arbLinkedItem(bank, 0.5)
              )
            ),
            fc.constant(bank)
          )
        ),
        ([resume, bank]) => {
          const resumeBefore = structuredClone(resume);
          const bankBefore = structuredClone(bank);
          const byId = toMap(bank);

          const resolved = resolveResume(resume, bank);

          expect(resolved.sections).toHaveLength(resume.sections.length);
          resume.sections.forEach((section, i) => {
            const out = resolved.sections[i];
            expect(out.id).toBe(section.id);
            expect(out.items).toHaveLength(section.items.length);
            section.items.forEach((item, j) => {
              const resolvedItem = out.items[j] as ResolvedItem;
              const state = linkState(item);
              const entry = state === "linked" ? byId.get(item.link!.bankId) : undefined;
              if (entry) {
                expectTakesWordingFromBank(item, resolvedItem, entry);
              } else if (state !== "linked") {
                expect(resolvedItem).toBe(item);
              }
            });
          });
          // Inputs are untouched.
          expect(resume).toStrictEqual(resumeBefore);
          expect(bank).toStrictEqual(bankBefore);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
