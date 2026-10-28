// Task 7.1: bakeOverlay (pure) and the detachItem store action (design §4.3).
import { beforeEach, describe, expect, it } from "vitest";
import { bakeOverlay, resolveItem } from "./resolve";
import { useResumeStore } from "./resumeStore";
import { makeSeedResume } from "./seed";
import type { BankItem, Item, Resume } from "./schema";

const makeEntry = (): BankItem => ({
  id: "bank1",
  kind: "experience",
  heading: "Bank Co",
  subheading: "Engineer",
  location: "Remote",
  dateRange: "2020 - 2022",
  bullets: [
    { id: "b1", text: "one" },
    { id: "b2", text: "two", hidden: true },
    { id: "b3", text: "three" },
    { id: "b4", text: "four" },
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
});

const linked = (over: Partial<Item> = {}): Item => ({
  id: "i1",
  link: { bankId: "bank1" },
  bullets: [],
  ...over,
});

const visible = (item: Item) => item.bullets.filter((b) => !b.hidden);

describe("bakeOverlay", () => {
  it("copies content fields and keeps id, hidden and bankId; sets detached", () => {
    const baked = bakeOverlay(linked({ hidden: true }), makeEntry());
    expect(baked).toMatchObject({
      id: "i1",
      hidden: true,
      heading: "Bank Co",
      subheading: "Engineer",
      location: "Remote",
      dateRange: "2020 - 2022",
      link: { bankId: "bank1", detached: true },
    });
  });

  it("re-attaches overlay-hidden bullets flagged hidden, in place", () => {
    const baked = bakeOverlay(linked({ hiddenBulletIds: ["b3"] }), makeEntry());
    expect(baked.bullets.map((b) => [b.id, !!b.hidden])).toEqual([
      ["b1", false],
      ["b2", true], // already hidden in the bank: stays hidden
      ["b3", true],
      ["b4", false],
    ]);
  });

  it("applies bulletOrder and appends unknown ids", () => {
    const baked = bakeOverlay(linked({ bulletOrder: ["b4", "ghost", "b1"] }), makeEntry());
    expect(baked.bullets.map((b) => b.id)).toEqual(["b4", "b1", "b2", "b3"]);
  });

  it("omits the overlay keys", () => {
    const baked = bakeOverlay(
      linked({ hiddenBulletIds: ["b1"], bulletOrder: ["b2"] }),
      makeEntry()
    );
    expect("hiddenBulletIds" in baked).toBe(false);
    expect("bulletOrder" in baked).toBe(false);
  });

  it("does not mutate the bank entry or the item, and copies bullets", () => {
    const entry = makeEntry();
    const item = linked({ hiddenBulletIds: ["b1"], bulletOrder: ["b3"] });
    const entryBefore = structuredClone(entry);
    const itemBefore = structuredClone(item);
    const baked = bakeOverlay(item, entry);
    expect(entry).toEqual(entryBefore);
    expect(item).toEqual(itemBefore);
    baked.bullets.forEach((b) => {
      expect(entry.bullets.includes(b)).toBe(false);
    });
  });

  it("visible projection equals resolveItem's bullets", () => {
    const entry = makeEntry();
    const item = linked({ hiddenBulletIds: ["b3"], bulletOrder: ["b4", "b1"] });
    const resolved = resolveItem(item, new Map([[entry.id, entry]]));
    expect(visible(bakeOverlay(item, entry))).toEqual(visible(resolved));
  });
});

describe("detachItem", () => {
  const s = () => useResumeStore.getState();
  const current = (): Resume =>
    s().variants.find((v) => v.id === s().currentVariantId)!;
  const raw = (sectionId: string, itemId: string) =>
    current()
      .sections.find((x) => x.id === sectionId)!
      .items.find((i) => i.id === itemId)!;

  let sectionId: string;
  let itemId: string;
  let otherItemId: string;

  beforeEach(() => {
    const seed = makeSeedResume("Test");
    const other = makeSeedResume("Other");
    sectionId = seed.sections[0].id;
    seed.sections[0].items = [
      linked({
        id: "i1",
        hiddenBulletIds: ["b3"],
        bulletOrder: ["b4", "b1"],
      }),
      linked({ id: "i2" }),
    ];
    itemId = "i1";
    otherItemId = "i2";
    useResumeStore.setState({
      variants: [seed, other],
      currentVariantId: seed.id,
      bank: [makeEntry()],
    });
  });

  it("bakes the overlay and marks the item detached", () => {
    s().detachItem(sectionId, itemId);
    const item = raw(sectionId, itemId);
    expect(item.link).toEqual({ bankId: "bank1", detached: true });
    expect(item.heading).toBe("Bank Co");
    expect(item.hiddenBulletIds).toBeUndefined();
    expect(item.bulletOrder).toBeUndefined();
    expect(item.bullets.map((b) => [b.id, !!b.hidden])).toEqual([
      ["b4", false],
      ["b1", false],
      ["b2", true],
      ["b3", true],
    ]);
  });

  it("keeps the rendered bullets identical to the pre-detach resolved view", () => {
    const bankById = new Map(s().bank.map((b) => [b.id, b]));
    const before = resolveItem(raw(sectionId, itemId), bankById);
    s().detachItem(sectionId, itemId);
    const after = resolveItem(raw(sectionId, itemId), bankById);
    expect(visible(after)).toEqual(visible(before));
    for (const k of ["heading", "subheading", "location", "dateRange"] as const) {
      expect(after[k]).toBe(before[k]);
    }
  });

  it("leaves the bank, other items and other variants untouched", () => {
    const bank = s().bank;
    const otherVariant = s().variants[1];
    const otherItem = raw(sectionId, otherItemId);
    s().detachItem(sectionId, itemId);
    expect(s().bank).toBe(bank);
    expect(s().variants[1]).toBe(otherVariant);
    expect(raw(sectionId, otherItemId)).toBe(otherItem);
  });

  it("is a no-op for detached, local, orphaned and missing items", () => {
    s().detachItem(sectionId, itemId);
    const afterFirst = s().variants;
    s().detachItem(sectionId, itemId); // already detached
    s().detachItem(sectionId, "nope"); // missing item
    s().detachItem("nope", itemId); // missing section
    expect(s().variants).toBe(afterFirst);

    useResumeStore.setState((st) => ({
      variants: st.variants.map((v, idx) =>
        idx === 0
          ? {
              ...v,
              sections: v.sections.map((sec, si) =>
                si === 0
                  ? {
                      ...sec,
                      items: [
                        { id: "loc", heading: "mine", bullets: [] },
                        { id: "orph", link: { bankId: "gone" }, bullets: [] },
                      ],
                    }
                  : sec
              ),
            }
          : v
      ),
    }));
    const before = s().variants;
    s().detachItem(sectionId, "loc");
    s().detachItem(sectionId, "orph");
    expect(s().variants).toBe(before);
    expect(raw(sectionId, "orph").link).toEqual({ bankId: "gone" });
  });
});
