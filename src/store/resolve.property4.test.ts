import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolveItem } from "./resolve";
import { arbLinkedItem, arbNonEmptyBank } from "./resolveArbitraries";
import type { BankItem, Item } from "./schema";

/**
 * Feature: item-bank-and-editor-ux, Property 4: The overlay reorders and hides
 * but never loses or duplicates a bank bullet
 *
 * For a linked item whose entry exists, with any overlay (stale ids not in the
 * entry, partial orderings, repeated ids, empty or absent keys), let V be the
 * entry's bullets minus those named in `hiddenBulletIds`. The resolved bullets
 * (a) contain each bullet of V exactly once, (b) contain nothing outside V,
 * (c) start with the ids named in `bulletOrder` that are in V (de-duplicated by
 * first occurrence, in that order), followed by the remaining V bullets in the
 * entry's original relative order. With no `bulletOrder` the order is V's.
 * Resolving is deterministic and never mutates its inputs.
 *
 * **Validates: Requirements 8.3**
 */

const NUM_RUNS = 200;

const toMap = (bank: readonly BankItem[]) => new Map(bank.map((b) => [b.id, b]));

/** The expected resolved bullet ids, computed independently of the resolver. */
function expectedIds(entry: BankItem, item: Item): string[] {
  const hidden = new Set(item.hiddenBulletIds ?? []);
  const visible = entry.bullets.map((b) => b.id).filter((id) => !hidden.has(id));
  const inV = new Set(visible);
  const head: string[] = [];
  for (const id of item.bulletOrder ?? []) {
    if (inV.has(id) && !head.includes(id)) head.push(id);
  }
  const named = new Set(head);
  return [...head, ...visible.filter((id) => !named.has(id))];
}

describe("Property 4: the overlay reorders and hides but never loses or duplicates a bank bullet", () => {
  it("resolved bullets are exactly V, each once, in overlay order then entry order", () => {
    fc.assert(
      fc.property(
        arbNonEmptyBank().chain((bank) =>
          fc.tuple(arbLinkedItem(bank, 0), fc.constant(bank))
        ),
        ([item, bank]) => {
          const itemBefore = structuredClone(item);
          const bankBefore = structuredClone(bank);
          const entry = bank.find((b) => b.id === item.link!.bankId)!;
          const byId = toMap(bank);

          const resolved = resolveItem(item, byId);
          const ids = resolved.bullets.map((b) => b.id);

          const hidden = new Set(item.hiddenBulletIds ?? []);
          const vIds = entry.bullets.map((b) => b.id).filter((id) => !hidden.has(id));

          // (a) no loss, no duplicates: same multiset as V.
          expect(ids).toHaveLength(vIds.length);
          expect(new Set(ids).size).toBe(ids.length);
          expect([...ids].sort()).toStrictEqual([...vIds].sort());
          // (b) nothing outside V: no hidden bullet resurrected, no stale id invented.
          for (const id of ids) {
            expect(vIds).toContain(id);
            expect(hidden.has(id)).toBe(false);
          }
          // (c) overlay-named first (first occurrence), then the rest in entry order.
          expect(ids).toStrictEqual(expectedIds(entry, item));
          if (!item.bulletOrder?.length) expect(ids).toStrictEqual(vIds);
          // Bullets are the bank's own objects' content.
          const entryBullets = new Map(entry.bullets.map((b) => [b.id, b]));
          for (const bullet of resolved.bullets) {
            expect(bullet).toStrictEqual(entryBullets.get(bullet.id));
          }

          // Deterministic: a second resolve is deep-equal.
          expect(resolveItem(item, byId)).toStrictEqual(resolved);
          // Inputs are untouched.
          expect(item).toStrictEqual(itemBefore);
          expect(bank).toStrictEqual(bankBefore);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("does not duplicate a bullet when bulletOrder repeats its id", () => {
    const entry: BankItem = {
      id: "bank-0",
      kind: "experience",
      bullets: [{ id: "bul-0", text: "only" }],
      updatedAt: "",
    };
    const item: Item = {
      id: "item-0",
      bullets: [],
      link: { bankId: "bank-0", detached: false },
      bulletOrder: ["bul-0", "bul-0"],
    };
    expect(resolveItem(item, toMap([entry])).bullets.map((b) => b.id)).toStrictEqual(["bul-0"]);
  });

  it("appends a bullet added to the entry after the overlay was written", () => {
    const entry: BankItem = {
      id: "bank-0",
      kind: "experience",
      bullets: [
        { id: "bul-0", text: "a" },
        { id: "bul-1", text: "b" },
        { id: "bul-2", text: "new" },
      ],
      updatedAt: "",
    };
    const item: Item = {
      id: "item-0",
      bullets: [],
      link: { bankId: "bank-0", detached: false },
      bulletOrder: ["bul-1", "gone", "bul-0"],
      hiddenBulletIds: ["also-gone"],
    };
    expect(resolveItem(item, toMap([entry])).bullets.map((b) => b.id)).toStrictEqual([
      "bul-1",
      "bul-0",
      "bul-2",
    ]);
  });
});
