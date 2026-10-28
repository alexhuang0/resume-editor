import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { linkState, resolveItem } from "./resolve";
import type { LinkState } from "./resolve";
import {
  arbBank,
  arbBankId,
  arbDetachedItem,
  arbItem,
  arbLinkedItem,
  arbLocalItem,
  arbResumeAndBank,
} from "./resolveArbitraries";
import type { BankItem, Item } from "./schema";

/**
 * Feature: item-bank-and-editor-ux, Property 9: Exactly one link state per item
 *
 * For any item, with or without `link`, with `detached` true, false, or absent,
 * the classifier reports exactly one of linked, detached, or local. Here that
 * means: the result is one of the three values; it matches the classification
 * computed independently from the raw fields; the three predicates partition
 * the item space; it depends on `link` alone; resolving never changes it; and
 * over a whole resume the per-state counts sum to the number of items.
 *
 * **Validates: Requirements 5.3, 7.8**
 */

const NUM_RUNS = 200;
const STATES: readonly LinkState[] = ["linked", "detached", "local"];

// Independent predicates over the raw fields (deliberately not via linkState).
const isLocal = (item: Item) => item.link === undefined;
const isDetached = (item: Item) => item.link !== undefined && item.link.detached === true;
const isLinked = (item: Item) => item.link !== undefined && item.link.detached !== true;

const toMap = (bank: readonly BankItem[]) => new Map(bank.map((b) => [b.id, b]));

/** Every link shape: none, `{bankId}`, `detached: false`, `detached: true`; bankIds real or dangling. */
const arbAnyShapeItem = (bank: readonly BankItem[]): fc.Arbitrary<Item> =>
  fc
    .tuple(
      arbLocalItem,
      arbBankId(bank, 0.5),
      fc.constantFrom<"none" | "bare" | "false" | "true">("none", "bare", "false", "true")
    )
    .map(([item, bankId, shape]) => {
      switch (shape) {
        case "none":
          return item;
        case "bare":
          return { ...item, link: { bankId } };
        case "false":
          return { ...item, link: { bankId, detached: false } };
        case "true":
          return { ...item, link: { bankId, detached: true } };
      }
    });

/** A bank and an item drawn from every generator plus the explicit-shape one. */
const arbBankAndItem = arbBank().chain((bank) =>
  fc
    .tuple(
      fc.constant(bank),
      fc.oneof(
        arbItem(bank),
        arbAnyShapeItem(bank),
        arbLocalItem,
        arbDetachedItem(bank),
        arbLinkedItem(bank)
      )
    )
);

/** Same `link` as `item`, every other field taken from `other`. */
function withOtherFields(item: Item, other: Item): Item {
  const rest: Item = structuredClone(other);
  delete rest.link;
  return item.link ? { ...rest, link: structuredClone(item.link) } : rest;
}

describe("Property 9: exactly one link state per item", () => {
  it("returns one of the three values, matching the classification from the raw fields", () => {
    fc.assert(
      fc.property(arbBankAndItem, ([, item]) => {
        const state = linkState(item);
        expect(STATES).toContain(state);
        if (!item.link) expect(state).toBe("local");
        else if (item.link.detached === true) expect(state).toBe("detached");
        else expect(state).toBe("linked");
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("the three predicates partition the item space and agree with linkState", () => {
    fc.assert(
      fc.property(arbBankAndItem, ([, item]) => {
        const holding = [isLocal(item), isDetached(item), isLinked(item)];
        expect(holding.filter(Boolean)).toHaveLength(1);
        const expected: LinkState = isLocal(item) ? "local" : isDetached(item) ? "detached" : "linked";
        expect(linkState(item)).toBe(expected);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("depends on `link` only: perturbing every other field never changes it", () => {
    fc.assert(
      fc.property(
        arbBankAndItem.chain(([bank, item]) =>
          fc.tuple(
            fc.constant(item),
            arbItem(bank),
            fc.boolean(),
            fc.string({ maxLength: 8 })
          )
        ),
        ([item, other, hidden, id]) => {
          const perturbed: Item = { ...withOtherFields(item, other), hidden, id };
          expect(perturbed.link).toStrictEqual(item.link);
          expect(linkState(perturbed)).toBe(linkState(item));
          // Wording / bullets / overlay wiped entirely.
          const bare: Item = item.link
            ? { id: item.id, bullets: [], link: item.link }
            : { id: item.id, bullets: [] };
          expect(linkState(bare)).toBe(linkState(item));
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("changing only `link.detached` moves between linked and detached; dropping `link` gives local", () => {
    fc.assert(
      fc.property(arbBankAndItem, ([, item]) => {
        const { link: _link, ...unlinked } = item;
        expect(linkState(unlinked)).toBe("local");
        if (!item.link) return;
        expect(linkState({ ...item, link: { ...item.link, detached: true } })).toBe("detached");
        expect(linkState({ ...item, link: { ...item.link, detached: false } })).toBe("linked");
        const { detached: _detached, ...bare } = item.link;
        expect(linkState({ ...item, link: bare })).toBe("linked");
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("resolving does not change the classification", () => {
    fc.assert(
      fc.property(arbBankAndItem, ([bank, item]) => {
        const resolved = resolveItem(item, toMap(bank));
        expect(linkState(resolved)).toBe(linkState(item));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("over a whole resume the counts of the three states sum to the number of items", () => {
    fc.assert(
      fc.property(arbResumeAndBank(), ({ resume }) => {
        const items = resume.sections.flatMap((s) => s.items);
        const counts: Record<LinkState, number> = { linked: 0, detached: 0, local: 0 };
        for (const item of items) counts[linkState(item)]++;
        expect(counts.linked + counts.detached + counts.local).toBe(items.length);
        expect(counts.linked).toBe(items.filter(isLinked).length);
        expect(counts.detached).toBe(items.filter(isDetached).length);
        expect(counts.local).toBe(items.filter(isLocal).length);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
