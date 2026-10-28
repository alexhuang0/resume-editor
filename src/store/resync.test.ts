// Task 7.2: resyncItem, hard overwrite with undo (design §4.3, Req 7.4).
import { beforeEach, describe, expect, it } from "vitest";
import { resolveItem } from "./resolve";
import { useResumeStore } from "./resumeStore";
import { useUiStore } from "./uiStore";
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
    { id: "b2", text: "two" },
    { id: "b3", text: "three" },
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
});

const s = () => useResumeStore.getState();
const toasts = () => useUiStore.getState().toasts;
const current = (): Resume =>
  s().variants.find((v) => v.id === s().currentVariantId)!;
const raw = (sectionId: string, itemId: string): Item | undefined =>
  current()
    .sections.find((x) => x.id === sectionId)
    ?.items.find((i) => i.id === itemId);

let sectionId: string;

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
  const seed = makeSeedResume("Test");
  const other = makeSeedResume("Other");
  sectionId = seed.sections[0].id;
  seed.sections[0].items = [
    {
      id: "i1",
      hidden: true,
      link: { bankId: "bank1" },
      bullets: [],
      hiddenBulletIds: ["b2"],
      bulletOrder: ["b3", "b1"],
    },
    { id: "i2", link: { bankId: "bank1" }, bullets: [] },
    { id: "loc", heading: "mine", bullets: [{ id: "x", text: "y" }] },
    { id: "orph", link: { bankId: "gone", detached: true }, heading: "o", bullets: [] },
  ];
  useResumeStore.setState({
    variants: [seed, other],
    currentVariantId: seed.id,
    bank: [makeEntry()],
  });
});

/** Detach i1 and edit its local wording, as a user would. */
const detachAndEdit = () => {
  s().detachItem(sectionId, "i1");
  s().updateItem(sectionId, "i1", { heading: "Local edit" });
  s().updateBullet(sectionId, "i1", "b1", "local bullet");
};

describe("resyncItem", () => {
  it("resolves to the bank's wording, with content keys and detached omitted", () => {
    detachAndEdit();
    s().resyncItem(sectionId, "i1");
    const item = raw(sectionId, "i1")!;
    expect(item).toEqual({ id: "i1", hidden: true, link: { bankId: "bank1" }, bullets: [] });
    for (const k of [
      "heading",
      "subheading",
      "location",
      "dateRange",
      "hiddenBulletIds",
      "bulletOrder",
    ]) {
      expect(k in item).toBe(false);
    }
    expect("detached" in item.link!).toBe(false);

    const bank = s().bank[0];
    const resolved = resolveItem(item, new Map([[bank.id, bank]]));
    expect(resolved.heading).toBe(bank.heading);
    expect(resolved.subheading).toBe(bank.subheading);
    expect(resolved.location).toBe(bank.location);
    expect(resolved.dateRange).toBe(bank.dateRange);
    expect(resolved.bullets).toEqual(bank.bullets); // unfiltered, bank order
  });

  it("pushes a toast naming what was replaced", () => {
    detachAndEdit();
    s().resyncItem(sectionId, "i1");
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].message).toBe(
      "Resynced from bank — local wording and hidden bullets replaced"
    );
    expect(toasts()[0].undo).toBeTypeOf("function");
  });

  it("undo restores the exact pre-resync raw item, baked hidden flags included", () => {
    detachAndEdit();
    const before = structuredClone(raw(sectionId, "i1")!);
    expect(before.bullets.some((b) => b.hidden)).toBe(true);
    s().resyncItem(sectionId, "i1");
    toasts()[0].undo!();
    expect(raw(sectionId, "i1")).toEqual(before);
  });

  it("undo works after the item has moved, and is a no-op once it is gone", () => {
    detachAndEdit();
    const before = structuredClone(raw(sectionId, "i1")!);
    s().resyncItem(sectionId, "i1");
    s().reorderItems(sectionId, ["i2", "loc", "orph", "i1"]);
    toasts()[0].undo!();
    const ids = current().sections.find((x) => x.id === sectionId)!.items.map((i) => i.id);
    expect(ids).toEqual(["i2", "loc", "orph", "i1"]);
    expect(raw(sectionId, "i1")).toEqual(before);

    s().resyncItem(sectionId, "i1");
    const undo = toasts()[1].undo!;
    s().deleteItem(sectionId, "i1");
    const variants = s().variants;
    undo();
    expect(s().variants).toBe(variants);
  });

  it("is a no-op for linked, local, orphaned and missing items", () => {
    const variants = s().variants;
    s().resyncItem(sectionId, "i2"); // linked
    s().resyncItem(sectionId, "loc"); // local
    s().resyncItem(sectionId, "orph"); // orphan
    s().resyncItem(sectionId, "nope"); // missing item
    s().resyncItem("nope", "i1"); // missing section
    expect(s().variants).toBe(variants);
    expect(toasts()).toHaveLength(0);
  });

  it("leaves the bank, other items and other variants untouched", () => {
    detachAndEdit();
    const bank = s().bank;
    const bankBefore = structuredClone(bank);
    const otherVariant = s().variants[1];
    const others = ["i2", "loc", "orph"].map((id) => raw(sectionId, id));
    s().resyncItem(sectionId, "i1");
    expect(s().bank).toBe(bank);
    expect(s().bank).toEqual(bankBefore);
    expect(s().variants[1]).toBe(otherVariant);
    expect(["i2", "loc", "orph"].map((id) => raw(sectionId, id))).toEqual(others);
    ["i2", "loc", "orph"].forEach((id, k) => expect(raw(sectionId, id)).toBe(others[k]));
  });
});
