// Task 8.1: link-aware toggleBulletHidden + overlayHiddenBullets (design §4.2, §4.3, §5.5).
import { beforeEach, describe, expect, it } from "vitest";
import { linkState, overlayHiddenBullets, resolveItem } from "./resolve";
import { useResumeStore } from "./resumeStore";
import { makeSeedResume } from "./seed";
import type { BankItem, Item, Resume } from "./schema";

const makeEntry = (): BankItem => ({
  id: "bank1",
  kind: "experience",
  heading: "Bank Co",
  bullets: [
    { id: "b1", text: "one" },
    { id: "b2", text: "two", hidden: true }, // hidden at bank level
    { id: "b3", text: "three" },
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
});

describe("overlayHiddenBullets", () => {
  const item = (hiddenBulletIds?: string[]): Item => ({
    id: "i1",
    link: { bankId: "bank1" },
    bullets: [],
    hiddenBulletIds,
  });

  it("returns [] when there is no overlay", () => {
    expect(overlayHiddenBullets(item(), makeEntry())).toEqual([]);
    expect(overlayHiddenBullets(item([]), makeEntry())).toEqual([]);
  });

  it("returns hidden entry bullets in entry order, ignoring unknown ids", () => {
    const out = overlayHiddenBullets(item(["b3", "ghost", "b1"]), makeEntry());
    expect(out.map((b) => b.id)).toEqual(["b1", "b3"]);
  });

  it("returns copies and mutates nothing", () => {
    const entry = makeEntry();
    const it_ = item(["b1"]);
    const before = structuredClone({ entry, it_ });
    const out = overlayHiddenBullets(it_, entry);
    expect(out[0]).toEqual(entry.bullets[0]);
    expect(out[0]).not.toBe(entry.bullets[0]);
    expect({ entry, it_ }).toEqual(before);
  });
});

describe("toggleBulletHidden", () => {
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
  const resolvedIds = (id: string) =>
    resolveItem(rawA(id), new Map(s().bank.map((b) => [b.id, b]))).bullets.map(
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
        ],
      },
      { id: "local", heading: "L", bullets: [{ id: "l1", text: "l1" }] },
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

  it("linked: add, remove, re-add; key omitted when the list empties", () => {
    s().toggleBulletHidden(sectionA, "linked", "b1");
    expect(rawA("linked").hiddenBulletIds).toEqual(["b1"]);
    expect(resolvedIds("linked")).toEqual(["b2", "b3"]);

    s().toggleBulletHidden(sectionA, "linked", "b3");
    expect(rawA("linked").hiddenBulletIds).toEqual(["b1", "b3"]);

    s().toggleBulletHidden(sectionA, "linked", "b1");
    expect(rawA("linked").hiddenBulletIds).toEqual(["b3"]);

    s().toggleBulletHidden(sectionA, "linked", "b3");
    expect("hiddenBulletIds" in rawA("linked")).toBe(false);
    expect(resolvedIds("linked")).toEqual(["b1", "b2", "b3"]);

    s().toggleBulletHidden(sectionA, "linked", "b1");
    expect(rawA("linked").hiddenBulletIds).toEqual(["b1"]);
    expect(resolvedIds("linked")).toEqual(["b2", "b3"]);
  });

  it("linked: stays linked, raw bullets stay empty, bank untouched, updatedAt bumps", () => {
    const bank = s().bank;
    const before = variantById(vA).updatedAt;
    s().toggleBulletHidden(sectionA, "linked", "b1");
    const item = rawA("linked");
    expect(linkState(item)).toBe("linked");
    expect(item.link).toEqual({ bankId: "bank1" });
    expect(item.bullets).toEqual([]);
    expect(item.heading).toBeUndefined();
    expect(s().bank).toBe(bank);
    expect(variantById(vA).updatedAt >= before).toBe(true);
    expect(variantById(vA)).not.toBe(variantById(vB));
  });

  it("linked: unknown bullet id writes nothing", () => {
    const variants = s().variants;
    s().toggleBulletHidden(sectionA, "linked", "ghost");
    expect(s().variants).toBe(variants);
    expect(s().variants[0]).toBe(variants[0]);
  });

  it("linked: overlay is per-variant", () => {
    const otherVariant = variantById(vB);
    const otherItem = raw(vB, sectionB, "linkedB");
    s().toggleBulletHidden(sectionA, "linked", "b1");
    expect(variantById(vB)).toBe(otherVariant);
    expect(raw(vB, sectionB, "linkedB")).toBe(otherItem);
    expect(otherItem.hiddenBulletIds).toBeUndefined();
  });

  it("linked: a bullet the bank itself hid toggles the overlay only", () => {
    const bank = s().bank;
    s().toggleBulletHidden(sectionA, "linked", "b2");
    expect(rawA("linked").hiddenBulletIds).toEqual(["b2"]);
    expect(rawA("linked").bullets).toEqual([]);
    expect(s().bank).toBe(bank);
    expect(s().bank[0].bullets[1].hidden).toBe(true);
    s().toggleBulletHidden(sectionA, "linked", "b2");
    expect("hiddenBulletIds" in rawA("linked")).toBe(false);
  });

  it("linked: overlay-hidden bullets are listed by overlayHiddenBullets for un-hiding", () => {
    s().toggleBulletHidden(sectionA, "linked", "b3");
    const hidden = overlayHiddenBullets(rawA("linked"), s().bank[0]);
    expect(hidden.map((b) => b.id)).toEqual(["b3"]);
    // Un-hide through the same action.
    s().toggleBulletHidden(sectionA, "linked", hidden[0].id);
    expect(resolvedIds("linked")).toEqual(["b1", "b2", "b3"]);
  });

  it("detached: toggles hidden on the raw bullet, no overlay", () => {
    s().toggleBulletHidden(sectionA, "detached", "d1");
    const item = rawA("detached");
    expect(linkState(item)).toBe("detached");
    expect(item.bullets.map((b) => [b.id, !!b.hidden])).toEqual([
      ["d1", true],
      ["d2", false],
    ]);
    expect(item.hiddenBulletIds).toBeUndefined();
    s().toggleBulletHidden(sectionA, "detached", "d1");
    expect(rawA("detached").bullets[0].hidden).toBe(false);
  });

  it("local: toggles hidden on the raw bullet", () => {
    s().toggleBulletHidden(sectionA, "local", "l1");
    expect(rawA("local").bullets[0].hidden).toBe(true);
    expect(rawA("local").hiddenBulletIds).toBeUndefined();
  });

  it("orphaned linked item: falls back to the raw bullet toggle", () => {
    s().toggleBulletHidden(sectionA, "orphan", "o2");
    const item = rawA("orphan");
    expect(item.bullets.map((b) => [b.id, !!b.hidden])).toEqual([
      ["o1", false],
      ["o2", true],
    ]);
    expect(item.hiddenBulletIds).toBeUndefined();
    expect(item.link).toEqual({ bankId: "gone" });
  });
});
