// Task 8.4: the overlay is applied through reorderByIds, so a bullet added to a
// bank entry AFTER the overlay was written appends instead of vanishing
// (Req 8.3, design §3). Drives the real store actions end to end.
import { beforeEach, describe, expect, it } from "vitest";
import { resolveItem, resolveResume } from "./resolve";
import { useResumeStore } from "./resumeStore";
import { makeSeedResume } from "./seed";
import type { Item, Resume } from "./schema";

describe("overlay + bullets added to / deleted from the bank entry", () => {
  const s = () => useResumeStore.getState();
  const variantById = (id: string): Resume =>
    s().variants.find((v) => v.id === id)!;

  let vA: string;
  let vB: string;
  let sectionA: string;

  const rawItem = (variantId: string, itemId: string): Item =>
    variantById(variantId).sections[0].items.find((i) => i.id === itemId)!;

  const bankMap = () => new Map(s().bank.map((b) => [b.id, b]));
  const ids = (variantId: string, itemId: string) =>
    resolveItem(rawItem(variantId, itemId), bankMap()).bullets.map((b) => b.id);
  // What useCurrentResume computes for a variant: resolveResume(variant, bank).
  const viaResolveResume = (variantId: string, itemId: string) =>
    resolveResume(variantById(variantId), s().bank)
      .sections[0].items.find((i) => i.id === itemId)!
      .bullets.map((b) => b.id);

  const expectBoth = (variantId: string, itemId: string, expected: string[]) => {
    expect(ids(variantId, itemId)).toEqual(expected);
    expect(viaResolveResume(variantId, itemId)).toEqual(expected);
  };

  const withCurrent = (variantId: string, fn: () => void) => {
    useResumeStore.setState({ currentVariantId: variantId });
    fn();
  };

  beforeEach(() => {
    const a = makeSeedResume("A");
    const b = makeSeedResume("B");
    vA = a.id;
    vB = b.id;
    sectionA = a.sections[0].id;
    a.sections[0].items = [{ id: "iA", link: { bankId: "bank1" }, bullets: [] }];
    b.sections[0].items = [{ id: "iB", link: { bankId: "bank1" }, bullets: [] }];
    useResumeStore.setState({
      variants: [a, b],
      currentVariantId: a.id,
      bank: [
        {
          id: "bank1",
          kind: "experience",
          heading: "Bank Co",
          bullets: [
            { id: "b1", text: "one" },
            { id: "b2", text: "two" },
            { id: "b3", text: "three" },
            { id: "b4", text: "four" },
          ],
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    });
    // Overlay in variant A via the real actions: order b4,b3,b2,b1 and hide b2.
    withCurrent(vA, () => {
      s().reorderBullets(sectionA, "iA", ["b4", "b3", "b2", "b1"]);
      s().toggleBulletHidden(sectionA, "iA", "b2");
    });
  });

  it("baseline: overlay in A, natural order in B", () => {
    expect(rawItem(vA, "iA").bulletOrder).toEqual(["b4", "b3", "b2", "b1"]);
    expect(rawItem(vA, "iA").hiddenBulletIds).toEqual(["b2"]);
    expectBoth(vA, "iA", ["b4", "b3", "b1"]);
    expectBoth(vB, "iB", ["b1", "b2", "b3", "b4"]);
  });

  it("a bullet added at the end of the entry appends in A and sits last naturally in B", () => {
    const n1 = s().addBankBullet("bank1")!;
    expect(n1).toBeTruthy();
    expectBoth(vA, "iA", ["b4", "b3", "b1", n1]);
    expectBoth(vB, "iB", ["b1", "b2", "b3", "b4", n1]);
  });

  it("a bullet added mid-entry (afterId) appends in A, not into the middle; natural position in B", () => {
    const n = s().addBankBullet("bank1", "b1")!;
    expect(s().bank[0].bullets.map((b) => b.id)).toEqual(["b1", n, "b2", "b3", "b4"]);
    expectBoth(vA, "iA", ["b4", "b3", "b1", n]);
    expectBoth(vB, "iB", ["b1", n, "b2", "b3", "b4"]);
  });

  it("several additions append in entry order; hidden bullets stay hidden; raw items are untouched", () => {
    const rawBeforeA = rawItem(vA, "iA");
    const rawBeforeB = rawItem(vB, "iB");
    const end = s().addBankBullet("bank1")!;
    const mid = s().addBankBullet("bank1", "b1")!;
    // Entry order: b1, mid, b2, b3, b4, end.
    expectBoth(vA, "iA", ["b4", "b3", "b1", mid, end]);
    expectBoth(vB, "iB", ["b1", mid, "b2", "b3", "b4", end]);
    expect(ids(vA, "iA")).not.toContain("b2");
    // The bank edit does not touch either variant's raw item.
    expect(rawItem(vA, "iA")).toBe(rawBeforeA);
    expect(rawItem(vB, "iB")).toBe(rawBeforeB);
  });

  it("un-hiding after an addition reveals the bullet appended after the ordered ones", () => {
    const n = s().addBankBullet("bank1")!;
    withCurrent(vA, () => s().toggleBulletHidden(sectionA, "iA", "b2"));
    // b2 is named in bulletOrder, so it returns to its ordered slot; n stays last.
    expectBoth(vA, "iA", ["b4", "b3", "b2", "b1", n]);
  });

  it("a bullet deleted from the bank that the overlay names is dropped: no error, no duplicates", () => {
    const n = s().addBankBullet("bank1")!;
    // b4 is in bulletOrder; b2 is in bulletOrder AND hiddenBulletIds.
    expect(s().deleteBankBullet("bank1", "b4")?.id).toBe("b4");
    expect(s().deleteBankBullet("bank1", "b2")?.id).toBe("b2");

    // Stale ids may remain in the raw overlay; resolution tolerates them.
    expect(() => ids(vA, "iA")).not.toThrow();
    expectBoth(vA, "iA", ["b3", "b1", n]);
    expectBoth(vB, "iB", ["b1", "b3", n]);
    for (const out of [ids(vA, "iA"), ids(vB, "iB")]) {
      expect(new Set(out).size).toBe(out.length);
    }

    // Adding again afterwards still appends.
    const m = s().addBankBullet("bank1", "b1")!;
    // Entry order: b1, m, b3, n. Unknown ids (m, n) append in entry order.
    expectBoth(vA, "iA", ["b3", "b1", m, n]);
    expectBoth(vB, "iB", ["b1", m, "b3", n]);
  });
});
