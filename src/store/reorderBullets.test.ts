// Task 8.2: link-aware reorderBullets writes the bulletOrder overlay (design §4.2, §4.3, §5.5).
import { beforeEach, describe, expect, it } from "vitest";
import { linkState, resolveItem } from "./resolve";
import { useResumeStore } from "./resumeStore";
import { makeSeedResume } from "./seed";
import type { BankItem, Item, Resume } from "./schema";

const makeEntry = (): BankItem => ({
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
});

describe("reorderBullets", () => {
  const s = () => useResumeStore.getState();
  const variantById = (id: string): Resume =>
    s().variants.find((v) => v.id === id)!;
  const raw = (variantId: string, sectionId: string, itemId: string): Item =>
    variantById(variantId)
      .sections.find((x) => x.id === sectionId)!
      .items.find((i) => i.id === itemId)!;

  let vA: string;
  let vB: string;
  let sectionA: string;
  let sectionB: string;

  const rawA = (id: string) => raw(vA, sectionA, id);
  const resolvedIds = (item: Item) =>
    resolveItem(item, new Map(s().bank.map((b) => [b.id, b]))).bullets.map(
      (b) => b.id
    );

  beforeEach(() => {
    const a = makeSeedResume("A");
    const b = makeSeedResume("B");
    vA = a.id;
    vB = b.id;
    sectionA = a.sections[0].id;
    sectionB = b.sections[0].id;
    a.sections[0].items = [
      { id: "linked", link: { bankId: "bank1" }, bullets: [] },
      {
        id: "detached",
        link: { bankId: "bank1", detached: true },
        heading: "Local",
        bullets: [
          { id: "d1", text: "d1" },
          { id: "d2", text: "d2" },
          { id: "d3", text: "d3" },
        ],
      },
      {
        id: "local",
        heading: "L",
        bullets: [
          { id: "l1", text: "l1" },
          { id: "l2", text: "l2" },
        ],
      },
      {
        id: "orphan",
        link: { bankId: "gone" },
        bullets: [
          { id: "o1", text: "typed" },
          { id: "o2", text: "typed2" },
        ],
      },
    ];
    b.sections[0].items = [
      { id: "linkedB", link: { bankId: "bank1" }, bullets: [] },
    ];
    useResumeStore.setState({
      variants: [a, b],
      currentVariantId: a.id,
      bank: [makeEntry()],
    });
  });

  it("linked: writes bulletOrder and resolve returns that order", () => {
    s().reorderBullets(sectionA, "linked", ["b3", "b1", "b4", "b2"]);
    expect(rawA("linked").bulletOrder).toEqual(["b3", "b1", "b4", "b2"]);
    expect(resolvedIds(rawA("linked"))).toEqual(["b3", "b1", "b4", "b2"]);
  });

  it("linked: stays linked, bullets stay [], bank is the same reference, updatedAt bumps", () => {
    const bank = s().bank;
    const before = variantById(vA).updatedAt;
    s().reorderBullets(sectionA, "linked", ["b2", "b1"]);
    const item = rawA("linked");
    expect(linkState(item)).toBe("linked");
    expect(item.link).toEqual({ bankId: "bank1" });
    expect(item.bullets).toEqual([]);
    expect(item.heading).toBeUndefined();
    expect(s().bank).toBe(bank);
    expect(variantById(vA).updatedAt >= before).toBe(true);
  });

  it("linked: drops stale/foreign ids and de-duplicates keeping the first occurrence", () => {
    s().reorderBullets(sectionA, "linked", ["b3", "ghost", "b1", "b3", "b1", "x"]);
    expect(rawA("linked").bulletOrder).toEqual(["b3", "b1"]);
    expect(resolvedIds(rawA("linked"))).toEqual(["b3", "b1", "b2", "b4"]);
  });

  it("linked: an empty normalized order omits the key", () => {
    s().reorderBullets(sectionA, "linked", ["b2", "b1"]);
    expect(rawA("linked").bulletOrder).toBeDefined();
    s().reorderBullets(sectionA, "linked", []);
    expect("bulletOrder" in rawA("linked")).toBe(false);
    expect(resolvedIds(rawA("linked"))).toEqual(["b1", "b2", "b3", "b4"]);

    s().reorderBullets(sectionA, "linked", ["ghost"]);
    expect("bulletOrder" in rawA("linked")).toBe(false);
  });

  it("linked: an unchanged order is a true no-op", () => {
    s().reorderBullets(sectionA, "linked", ["b2", "b1"]);
    const variants = s().variants;
    s().reorderBullets(sectionA, "linked", ["b2", "b1"]);
    expect(s().variants).toBe(variants);
    // Equivalent after normalization (stale + duplicate ids).
    s().reorderBullets(sectionA, "linked", ["ghost", "b2", "b2", "b1"]);
    expect(s().variants).toBe(variants);
  });

  it("linked: empty order on an item with no bulletOrder is a no-op", () => {
    const variants = s().variants;
    s().reorderBullets(sectionA, "linked", []);
    s().reorderBullets(sectionA, "linked", ["ghost"]);
    expect(s().variants).toBe(variants);
  });

  it("linked: a bullet added to the entry afterwards appends in every linked variant", () => {
    s().reorderBullets(sectionA, "linked", ["b4", "b3", "b2", "b1"]);
    useResumeStore.setState({
      bank: [
        {
          ...makeEntry(),
          bullets: [...makeEntry().bullets, { id: "b5", text: "five" }],
        },
      ],
    });
    expect(resolvedIds(rawA("linked"))).toEqual(["b4", "b3", "b2", "b1", "b5"]);
    expect(resolvedIds(raw(vB, sectionB, "linkedB"))).toEqual([
      "b1",
      "b2",
      "b3",
      "b4",
      "b5",
    ]);
  });

  it("linked: overlay is per-variant", () => {
    const otherVariant = variantById(vB);
    const otherItem = raw(vB, sectionB, "linkedB");
    s().reorderBullets(sectionA, "linked", ["b4", "b1"]);
    expect(variantById(vB)).toBe(otherVariant);
    expect(raw(vB, sectionB, "linkedB")).toBe(otherItem);
    expect(otherItem.bulletOrder).toBeUndefined();
  });

  it("linked: overlay-hidden bullets stay hidden and are not lost", () => {
    s().toggleBulletHidden(sectionA, "linked", "b2");
    expect(resolvedIds(rawA("linked"))).toEqual(["b1", "b3", "b4"]);

    // The editor passes only what it shows (hidden b2 excluded).
    s().reorderBullets(sectionA, "linked", ["b4", "b3", "b1"]);
    const item = rawA("linked");
    expect(item.bulletOrder).toEqual(["b4", "b3", "b1"]);
    expect(item.hiddenBulletIds).toEqual(["b2"]);
    expect(item.bullets).toEqual([]);
    expect(resolvedIds(item)).toEqual(["b4", "b3", "b1"]);

    // Un-hiding reveals b2, appended after the ordered ones (unknown ids append).
    s().toggleBulletHidden(sectionA, "linked", "b2");
    expect("hiddenBulletIds" in rawA("linked")).toBe(false);
    expect(resolvedIds(rawA("linked"))).toEqual(["b4", "b3", "b1", "b2"]);
  });

  it("linked: hide one, reorder the rest, un-hide: unknowns append in entry order", () => {
    s().toggleBulletHidden(sectionA, "linked", "b1");
    s().toggleBulletHidden(sectionA, "linked", "b3");
    expect(resolvedIds(rawA("linked"))).toEqual(["b2", "b4"]);
    s().reorderBullets(sectionA, "linked", ["b4", "b2"]);
    s().toggleBulletHidden(sectionA, "linked", "b3");
    expect(resolvedIds(rawA("linked"))).toEqual(["b4", "b2", "b3"]);
    s().toggleBulletHidden(sectionA, "linked", "b1");
    expect(resolvedIds(rawA("linked"))).toEqual(["b4", "b2", "b1", "b3"]);
  });

  it("detached: reorders the raw bullets, no overlay", () => {
    s().reorderBullets(sectionA, "detached", ["d3", "d1", "d2"]);
    const item = rawA("detached");
    expect(linkState(item)).toBe("detached");
    expect(item.bullets.map((b) => b.id)).toEqual(["d3", "d1", "d2"]);
    expect(item.bulletOrder).toBeUndefined();
  });

  it("local: reorders the raw bullets", () => {
    s().reorderBullets(sectionA, "local", ["l2", "l1"]);
    expect(rawA("local").bullets.map((b) => b.id)).toEqual(["l2", "l1"]);
    expect(rawA("local").bulletOrder).toBeUndefined();
  });

  it("orphaned linked item: falls back to reordering the raw bullets", () => {
    s().reorderBullets(sectionA, "orphan", ["o2", "o1"]);
    const item = rawA("orphan");
    expect(item.bullets.map((b) => b.id)).toEqual(["o2", "o1"]);
    expect(item.bulletOrder).toBeUndefined();
    expect(item.link).toEqual({ bankId: "gone" });
  });
});
