// Task 7.3: pushItemToBank and pushWarnsHiddenBullets (design §4.3, §5.7, Req 7.5).
import { beforeEach, describe, expect, it } from "vitest";
import { resolveItem } from "./resolve";
import { useResumeStore } from "./resumeStore";
import { useUiStore } from "./uiStore";
import { makeSeedResume } from "./seed";
import {
  pushHiddenBulletsMessage,
  pushWarnsHiddenBullets,
} from "./pushWarnsHiddenBullets";
import type { BankItem, Item, Resume } from "./schema";

const makeEntry = (id = "bank1"): BankItem => ({
  id,
  kind: "experience",
  label: "My label",
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
const resolveRaw = (item: Item, bank = s().bank) =>
  resolveItem(item, new Map(bank.map((b) => [b.id, b])));
const visible = (item: Item) => ({
  heading: item.heading,
  subheading: item.subheading,
  location: item.location,
  dateRange: item.dateRange,
  bullets: item.bullets.filter((b) => !b.hidden).map((b) => b.text),
});

let sectionId: string;
let otherSectionId: string;

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
  const seed = makeSeedResume("Test");
  const other = makeSeedResume("Other");
  sectionId = seed.sections[0].id;
  otherSectionId = other.sections[0].id;
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
    { id: "det2", link: { bankId: "bank2", detached: true }, heading: "d2", bullets: [] },
  ];
  other.sections[0].items = [
    { id: "o1", link: { bankId: "bank1" }, bullets: [] },
  ];
  useResumeStore.setState({
    variants: [seed, other],
    currentVariantId: seed.id,
    bank: [makeEntry(), makeEntry("bank2")],
  });
});

const detachAndEdit = () => {
  s().detachItem(sectionId, "i1");
  s().updateItem(sectionId, "i1", { heading: "Local edit", location: undefined });
  s().updateBullet(sectionId, "i1", "b1", "local bullet");
};

describe("pushItemToBank", () => {
  it("writes the local wording into the bank entry and bumps updatedAt", () => {
    detachAndEdit();
    const local = structuredClone(raw(sectionId, "i1")!);
    const other = s().bank[1];
    expect(s().pushItemToBank(sectionId, "i1")).toBe(true);

    const entry = s().bank[0];
    expect(entry.heading).toBe("Local edit");
    expect(entry.subheading).toBe(local.subheading);
    expect(entry.location).toBeUndefined();
    expect(entry.dateRange).toBe(local.dateRange);
    expect(entry.bullets).toEqual(local.bullets);
    expect(entry.bullets).not.toBe(local.bullets);
    expect(entry.bullets[0]).not.toBe(local.bullets[0]);
    expect(entry.updatedAt > "2024-01-01T00:00:00.000Z").toBe(true);
    // Identity fields untouched, other entries untouched.
    expect(entry.id).toBe("bank1");
    expect(entry.kind).toBe("experience");
    expect(entry.label).toBe("My label");
    expect(s().bank[1]).toBe(other);
  });

  it("leaves a linked item with no local content that resolves to the pre-push view", () => {
    detachAndEdit();
    const before = visible(raw(sectionId, "i1")!);
    s().pushItemToBank(sectionId, "i1");

    const item = raw(sectionId, "i1")!;
    expect(item).toEqual({ id: "i1", hidden: true, link: { bankId: "bank1" }, bullets: [] });
    for (const k of ["heading", "subheading", "location", "dateRange", "hiddenBulletIds", "bulletOrder"]) {
      expect(k in item).toBe(false);
    }
    expect("detached" in item.link!).toBe(false);
    expect(visible(resolveRaw(item))).toEqual(before);
  });

  it("preserves baked hidden flags as bank-level flags", () => {
    detachAndEdit();
    s().pushItemToBank(sectionId, "i1");
    expect(s().bank[0].bullets.filter((b) => b.hidden).map((b) => b.id)).toEqual(["b2"]);
  });

  it("is picked up by another variant linked to the same entry", () => {
    detachAndEdit();
    s().pushItemToBank(sectionId, "i1");
    const o1 = s().variants[1].sections[0].items[0];
    expect(o1.bullets).toEqual([]);
    expect(resolveRaw(o1).heading).toBe("Local edit");
    expect(otherSectionId).toBeTruthy();
  });

  it("is a no-op for linked, local, orphaned and missing items", () => {
    const variants = s().variants;
    const bank = s().bank;
    expect(s().pushItemToBank(sectionId, "i2")).toBe(false); // linked
    expect(s().pushItemToBank(sectionId, "loc")).toBe(false); // local
    expect(s().pushItemToBank(sectionId, "orph")).toBe(false); // orphan
    expect(s().pushItemToBank(sectionId, "nope")).toBe(false);
    expect(s().pushItemToBank("nope", "i1")).toBe(false);
    expect(s().variants).toBe(variants);
    expect(s().bank).toBe(bank);
    expect(toasts()).toHaveLength(0);
  });

  it("leaves other items and other detached items untouched", () => {
    detachAndEdit();
    const others = ["i2", "loc", "orph", "det2"].map((id) => raw(sectionId, id));
    const otherVariant = s().variants[1];
    s().pushItemToBank(sectionId, "i1");
    ["i2", "loc", "orph", "det2"].forEach((id, k) => expect(raw(sectionId, id)).toBe(others[k]));
    expect(s().variants[1]).toBe(otherVariant);
  });

  it("undo restores the exact previous bank entry and raw item", () => {
    detachAndEdit();
    const itemBefore = structuredClone(raw(sectionId, "i1")!);
    const bankBefore = structuredClone(s().bank);
    s().pushItemToBank(sectionId, "i1");
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].message).toBe("Pushed local wording to the bank");
    toasts()[0].undo!();
    expect(s().bank).toEqual(bankBefore);
    expect(raw(sectionId, "i1")).toEqual(itemBefore);
  });

  it("undo is a no-op once the item is gone", () => {
    detachAndEdit();
    s().pushItemToBank(sectionId, "i1");
    const undo = toasts()[0].undo!;
    s().deleteItem(sectionId, "i1");
    const { variants, bank } = s();
    undo();
    expect(s().variants).toBe(variants);
    expect(s().bank).toBe(bank);
  });
});

describe("pushWarnsHiddenBullets", () => {
  const item = (bullets: Item["bullets"]): Item => ({ id: "x", bullets });
  it("is false with no bullets or none hidden", () => {
    expect(pushWarnsHiddenBullets(item([]))).toBe(false);
    expect(pushWarnsHiddenBullets(item([{ id: "a", text: "t" }]))).toBe(false);
    expect(pushWarnsHiddenBullets(item([{ id: "a", text: "t", hidden: false }]))).toBe(false);
  });
  it("is true when any bullet is hidden", () => {
    expect(pushWarnsHiddenBullets(item([{ id: "a", text: "t", hidden: true }]))).toBe(true);
    expect(
      pushWarnsHiddenBullets(
        item([
          { id: "a", text: "t" },
          { id: "b", text: "u", hidden: true },
        ])
      )
    ).toBe(true);
  });
  it("words the message with the hidden count", () => {
    const m = pushHiddenBulletsMessage(
      item([
        { id: "a", text: "t", hidden: true },
        { id: "b", text: "u", hidden: true },
      ])
    );
    expect(m).toContain("2 bullets are hidden in this variant");
    expect(m).toContain("EVERY variant");
  });
});
