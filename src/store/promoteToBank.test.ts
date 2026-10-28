// Task 7.4: promoteItemToBank (design §4.3, Req 5.4, 7.5).
import { beforeEach, describe, expect, it } from "vitest";
import { resolveItem } from "./resolve";
import { useResumeStore } from "./resumeStore";
import { useUiStore } from "./uiStore";
import { makeSeedResume } from "./seed";
import type { BankItem, Item, Resume } from "./schema";

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
// What ResumePreview shows: content fields plus bullets without `hidden`.
const visible = (item: Item) => ({
  heading: item.heading,
  subheading: item.subheading,
  location: item.location,
  dateRange: item.dateRange,
  bullets: item.bullets.filter((b) => !b.hidden).map((b) => b.text),
});

const existing: BankItem = {
  id: "bank1",
  kind: "experience",
  heading: "Bank Co",
  bullets: [{ id: "bb1", text: "bank" }],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

let sectionId: string; // experience
let skillsSectionId: string;
let otherVariantSectionId: string;

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
  const seed = makeSeedResume("Test");
  const other = makeSeedResume("Other");
  sectionId = seed.sections[0].id;
  skillsSectionId = "sec-skills";
  otherVariantSectionId = other.sections[0].id;
  seed.sections[0].kind = "experience";
  seed.sections[0].items = [
    {
      id: "loc",
      hidden: true,
      heading: "Acme",
      subheading: "Engineer",
      location: "",
      dateRange: undefined,
      bullets: [
        { id: "x1", text: "one" },
        { id: "x2", text: "two", hidden: true },
        { id: "x3", text: "three" },
      ],
    },
    { id: "loc2", heading: "other local", bullets: [{ id: "y", text: "y" }] },
    { id: "lnk", link: { bankId: "bank1" }, bullets: [] },
    { id: "det", link: { bankId: "bank1", detached: true }, heading: "d", bullets: [] },
  ];
  seed.sections.push({
    id: skillsSectionId,
    kind: "skills",
    title: "Skills",
    items: [
      {
        id: "sk",
        heading: "Languages",
        bullets: [{ id: "sb", text: "TS, Go" }],
      },
    ],
  });
  other.sections[0].items = [
    { id: "o1", heading: "variant-b local", bullets: [{ id: "ob", text: "ob" }] },
  ];
  useResumeStore.setState({
    variants: [seed, other],
    currentVariantId: seed.id,
    bank: [existing],
  });
});

describe("promoteItemToBank", () => {
  it("creates a bank entry from the item with the section's kind and preserved bullet ids", () => {
    const local = structuredClone(raw(sectionId, "loc")!);
    const id = s().promoteItemToBank(sectionId, "loc")!;
    expect(id).toBeTruthy();
    expect(s().bank).toHaveLength(2);
    expect(s().bank[0]).toBe(existing);

    const entry = s().bank[1];
    expect(entry.id).toBe(id);
    expect(id.startsWith("bk_")).toBe(true);
    expect(entry.kind).toBe("experience");
    expect(entry.heading).toBe("Acme");
    expect(entry.subheading).toBe("Engineer");
    expect(entry.location).toBe("");
    expect(entry.dateRange).toBeUndefined();
    expect(entry.bullets).toEqual(local.bullets); // ids and hidden flags kept
    expect("label" in entry).toBe(false);
    expect(Number.isNaN(Date.parse(entry.updatedAt))).toBe(false);
  });

  it("does not alias the item's bullets into the bank", () => {
    const before = raw(sectionId, "loc")!.bullets;
    s().promoteItemToBank(sectionId, "loc");
    const entry = s().bank[1];
    entry.bullets.forEach((b, k) => expect(b).not.toBe(before[k]));
  });

  it("links the item and clears local content, bullets and overlay keys", () => {
    const id = s().promoteItemToBank(sectionId, "loc")!;
    const item = raw(sectionId, "loc")!;
    expect(item).toEqual({ id: "loc", hidden: true, link: { bankId: id }, bullets: [] });
    for (const k of ["heading", "subheading", "location", "dateRange", "hiddenBulletIds", "bulletOrder"]) {
      expect(k in item).toBe(false);
    }
    expect("detached" in item.link!).toBe(false);
  });

  it("keeps the rendered output unchanged, hidden-flagged bullets included", () => {
    const before = raw(sectionId, "loc")!;
    const beforeView = visible(before);
    s().promoteItemToBank(sectionId, "loc");
    const resolved = resolveRaw(raw(sectionId, "loc")!);
    expect(visible(resolved)).toEqual(beforeView);
    // Hidden flags survive as bank-level flags: the full bullet list matches.
    expect(resolved.bullets).toEqual(before.bullets);
    expect(resolved.bullets.map((b) => b.hidden)).toEqual([undefined, true, undefined]);
  });

  it("takes kind from the section and works for skills rows", () => {
    const id = s().promoteItemToBank(skillsSectionId, "sk")!;
    const entry = s().bank.find((b) => b.id === id)!;
    expect(entry.kind).toBe("skills");
    expect(entry.heading).toBe("Languages");
    expect(entry.bullets).toEqual([{ id: "sb", text: "TS, Go" }]);
    const item = raw(skillsSectionId, "sk")!;
    expect(item.bullets).toEqual([]);
    expect(resolveRaw(item).bullets[0].text).toBe("TS, Go");
  });

  it("is a no-op for linked, detached and missing items", () => {
    const variants = s().variants;
    const bank = s().bank;
    expect(s().promoteItemToBank(sectionId, "lnk")).toBeNull();
    expect(s().promoteItemToBank(sectionId, "det")).toBeNull();
    expect(s().promoteItemToBank(sectionId, "nope")).toBeNull();
    expect(s().promoteItemToBank("nope", "loc")).toBeNull();
    expect(s().variants).toBe(variants);
    expect(s().bank).toBe(bank);
    expect(toasts()).toHaveLength(0);
  });

  it("is a no-op when the item lives in another variant", () => {
    expect(s().promoteItemToBank(otherVariantSectionId, "o1")).toBeNull();
  });

  it("leaves other items, sections and variants untouched", () => {
    const others = ["loc2", "lnk", "det"].map((id) => raw(sectionId, id));
    const skills = current().sections[1];
    const otherVariant = s().variants[1];
    s().promoteItemToBank(sectionId, "loc");
    ["loc2", "lnk", "det"].forEach((id, k) => expect(raw(sectionId, id)).toBe(others[k]));
    expect(current().sections[1]).toBe(skills);
    expect(s().variants[1]).toBe(otherVariant);
  });

  it("pushes an 'Added to bank' toast", () => {
    s().promoteItemToBank(sectionId, "loc");
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].message).toBe("Added to bank");
  });

  it("undo restores the exact raw item and removes the new entry", () => {
    const before = structuredClone(raw(sectionId, "loc")!);
    const bankBefore = s().bank;
    s().promoteItemToBank(sectionId, "loc");
    toasts()[0].undo!();
    expect(raw(sectionId, "loc")).toEqual(before);
    expect(s().bank).toEqual(bankBefore);
  });

  it("undo keeps the entry when another item references it", () => {
    const id = s().promoteItemToBank(sectionId, "loc")!;
    s().addItemFromBank(sectionId, id);
    const before = s().bank;
    toasts()[0].undo!();
    expect(raw(sectionId, "loc")!.heading).toBe("Acme");
    expect(s().bank).toBe(before);
    expect(s().bank.some((b) => b.id === id)).toBe(true);
  });

  it("undo is a no-op once the item is gone", () => {
    s().promoteItemToBank(sectionId, "loc");
    const undo = toasts()[0].undo!;
    s().deleteItem(sectionId, "loc");
    const { variants, bank } = s();
    undo();
    expect(s().variants).toBe(variants);
    expect(s().bank).toBe(bank);
  });
});
