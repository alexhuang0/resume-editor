// Task 7.5: forkItemToNewBankItem (design §4.3 Detached --> Linked, §4.4, Req 7.5).
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
const visible = (item: Item) => ({
  heading: item.heading,
  subheading: item.subheading,
  location: item.location,
  dateRange: item.dateRange,
  bullets: item.bullets.filter((b) => !b.hidden).map((b) => b.text),
});

const original: BankItem = {
  id: "bank1",
  kind: "experience",
  label: "Acme role",
  heading: "Bank Co",
  subheading: "Staff",
  bullets: [
    { id: "bb1", text: "one" },
    { id: "bb2", text: "two" },
    { id: "bb3", text: "three" },
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
};
const unlabeled: BankItem = {
  id: "bank2",
  kind: "experience",
  heading: "Plain",
  bullets: [{ id: "pb", text: "p" }],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

let sectionId: string;
let otherVariantSectionId: string;

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
  const seed = makeSeedResume("Test");
  const other = makeSeedResume("Other");
  sectionId = seed.sections[0].id;
  otherVariantSectionId = other.sections[0].id;
  seed.sections[0].kind = "experience";
  seed.sections[0].items = [
    {
      id: "det",
      hidden: true,
      link: { bankId: "bank1", detached: true },
      heading: "Local Co",
      subheading: "Eng",
      location: "NYC",
      dateRange: "2020",
      bullets: [
        { id: "d1", text: "a" },
        { id: "d2", text: "b", hidden: true },
      ],
    },
    {
      id: "lnk",
      link: { bankId: "bank1" },
      hiddenBulletIds: ["bb2"],
      bulletOrder: ["bb3", "bb1"],
      bullets: [],
    },
    { id: "lnk2", link: { bankId: "bank1" }, bullets: [] },
    { id: "plain", link: { bankId: "bank2" }, bullets: [] },
    {
      id: "detNoEntry",
      link: { bankId: "gone", detached: true },
      heading: "Orphan detached",
      bullets: [{ id: "n1", text: "n" }],
    },
    { id: "orph", link: { bankId: "gone" }, bullets: [] },
    { id: "loc", heading: "local", bullets: [{ id: "l1", text: "l" }] },
  ];
  other.sections[0].items = [
    { id: "o1", link: { bankId: "bank1" }, bullets: [] },
  ];
  useResumeStore.setState({
    variants: [seed, other],
    currentVariantId: seed.id,
    bank: [original, unlabeled],
  });
});

describe("forkItemToNewBankItem: detached", () => {
  it("builds a new entry from the item's own wording and links to it", () => {
    const before = structuredClone(raw(sectionId, "det")!);
    const id = s().forkItemToNewBankItem(sectionId, "det")!;
    expect(id.startsWith("bk_")).toBe(true);
    expect(id).not.toBe("bank1");
    expect(s().bank).toHaveLength(3);
    expect(s().bank[2].id).toBe(id);

    const entry = s().bank[2];
    expect(entry.kind).toBe("experience");
    expect(entry.heading).toBe("Local Co");
    expect(entry.subheading).toBe("Eng");
    expect(entry.location).toBe("NYC");
    expect(entry.dateRange).toBe("2020");
    expect(entry.bullets).toEqual(before.bullets); // ids and hidden kept
    expect(entry.label).toBe("Acme role (fork)");

    const item = raw(sectionId, "det")!;
    expect(item).toEqual({ id: "det", hidden: true, link: { bankId: id }, bullets: [] });
    expect("detached" in item.link!).toBe(false);
  });

  it("leaves the original entry untouched (same reference)", () => {
    s().forkItemToNewBankItem(sectionId, "det");
    expect(s().bank[0]).toBe(original);
    expect(s().bank[1]).toBe(unlabeled);
  });

  it("keeps the visible projection unchanged", () => {
    const beforeView = visible(raw(sectionId, "det")!);
    s().forkItemToNewBankItem(sectionId, "det");
    expect(visible(resolveRaw(raw(sectionId, "det")!))).toEqual(beforeView);
  });

  it("works when the original entry no longer exists, with no label", () => {
    const id = s().forkItemToNewBankItem(sectionId, "detNoEntry")!;
    const entry = s().bank.find((b) => b.id === id)!;
    expect(entry.heading).toBe("Orphan detached");
    expect("label" in entry).toBe(false);
    expect(raw(sectionId, "detNoEntry")!.link).toEqual({ bankId: id });
  });

  it("omits the label when the original entry has none", () => {
    // Re-point det at the unlabeled entry.
    useResumeStore.setState((st) => ({
      variants: st.variants.map((v) => ({
        ...v,
        sections: v.sections.map((sec) => ({
          ...sec,
          items: sec.items.map((i) =>
            i.id === "det" ? { ...i, link: { bankId: "bank2", detached: true } } : i
          ),
        })),
      })),
    }));
    const id = s().forkItemToNewBankItem(sectionId, "det")!;
    expect("label" in s().bank.find((b) => b.id === id)!).toBe(false);
  });
});

describe("forkItemToNewBankItem: linked", () => {
  it("bakes the overlay: hidden stays hidden, order is preserved", () => {
    const beforeResolved = resolveRaw(raw(sectionId, "lnk")!);
    expect(beforeResolved.bullets.map((b) => b.id)).toEqual(["bb3", "bb1"]);

    const id = s().forkItemToNewBankItem(sectionId, "lnk")!;
    const entry = s().bank.find((b) => b.id === id)!;
    expect(entry.heading).toBe("Bank Co");
    expect(entry.bullets).toEqual([
      { id: "bb3", text: "three" },
      { id: "bb1", text: "one" },
      { id: "bb2", text: "two", hidden: true },
    ]);

    const item = raw(sectionId, "lnk")!;
    expect(item).toEqual({ id: "lnk", link: { bankId: id }, bullets: [] });
    for (const k of ["hiddenBulletIds", "bulletOrder", "heading"]) {
      expect(k in item).toBe(false);
    }
    expect(visible(resolveRaw(item))).toEqual(visible(beforeResolved));
    expect(s().bank[0]).toBe(original);
  });

  it("leaves other items linked to the original entry unaffected", () => {
    const sibling = raw(sectionId, "lnk2");
    const otherVariantItem = s().variants[1].sections[0].items[0];
    s().forkItemToNewBankItem(sectionId, "lnk");
    expect(raw(sectionId, "lnk2")).toBe(sibling);
    expect(s().variants[1].sections[0].items[0]).toBe(otherVariantItem);
    expect(resolveRaw(raw(sectionId, "lnk2")!).heading).toBe("Bank Co");
  });

  it("labels nothing when the original has no label", () => {
    const id = s().forkItemToNewBankItem(sectionId, "plain")!;
    expect("label" in s().bank.find((b) => b.id === id)!).toBe(false);
  });
});

describe("forkItemToNewBankItem: orphaned linked (task 7.9)", () => {
  it("forks an untouched orphan into an empty entry and links to it", () => {
    const id = s().forkItemToNewBankItem(sectionId, "orph")!;
    expect(id.startsWith("bk_")).toBe(true);
    const entry = s().bank.find((b) => b.id === id)!;
    expect(entry.kind).toBe("experience");
    expect(entry.bullets).toEqual([]);
    expect("label" in entry).toBe(false);
    expect(raw(sectionId, "orph")).toEqual({
      id: "orph",
      link: { bankId: id },
      bullets: [],
    });
  });

  it("builds the entry from wording typed while orphaned", () => {
    s().updateItem(sectionId, "orph", { heading: "Typed Co", dateRange: "2024" });
    s().updateItem(sectionId, "orph", {
      bullets: [
        { id: "t1", text: "typed one" },
        { id: "t2", text: "typed two", hidden: true },
      ],
    });
    // Still linked (no bank entry to bake from), wording lives on the item.
    expect(raw(sectionId, "orph")!.link).toEqual({ bankId: "gone" });

    const id = s().forkItemToNewBankItem(sectionId, "orph")!;
    const entry = s().bank.find((b) => b.id === id)!;
    expect(entry.heading).toBe("Typed Co");
    expect(entry.dateRange).toBe("2024");
    expect(entry.bullets).toEqual([
      { id: "t1", text: "typed one" },
      { id: "t2", text: "typed two", hidden: true },
    ]);
    expect(raw(sectionId, "orph")).toEqual({
      id: "orph",
      link: { bankId: id },
      bullets: [],
    });
    expect(visible(resolveRaw(raw(sectionId, "orph")!)).heading).toBe("Typed Co");
    expect(toasts()[0].message).toBe("Forked to a new bank entry");
  });

  it("undo restores the exact raw orphan and removes the new entry", () => {
    s().updateItem(sectionId, "orph", { heading: "Typed Co" });
    const before = structuredClone(raw(sectionId, "orph")!);
    s().forkItemToNewBankItem(sectionId, "orph");
    expect(s().bank).toHaveLength(3);
    toasts()[0].undo!();
    expect(raw(sectionId, "orph")).toEqual(before);
    expect(s().bank).toHaveLength(2);
  });
});

describe("forkItemToNewBankItem: no-ops", () => {
  it("returns null and changes nothing for local and missing items", () => {
    const variants = s().variants;
    const bank = s().bank;
    expect(s().forkItemToNewBankItem(sectionId, "loc")).toBeNull();
    expect(s().forkItemToNewBankItem(sectionId, "nope")).toBeNull();
    expect(s().forkItemToNewBankItem("nope", "det")).toBeNull();
    expect(s().forkItemToNewBankItem(otherVariantSectionId, "o1")).toBeNull();
    expect(s().variants).toBe(variants);
    expect(s().bank).toBe(bank);
    expect(toasts()).toHaveLength(0);
  });
});

describe("forkItemToNewBankItem: isolation and undo", () => {
  it("leaves other items and variants untouched", () => {
    const others = ["lnk", "lnk2", "plain", "orph", "loc"].map((id) =>
      raw(sectionId, id)
    );
    const otherVariant = s().variants[1];
    s().forkItemToNewBankItem(sectionId, "det");
    ["lnk", "lnk2", "plain", "orph", "loc"].forEach((id, k) =>
      expect(raw(sectionId, id)).toBe(others[k])
    );
    expect(s().variants[1]).toBe(otherVariant);
  });

  it("pushes a 'Forked to a new bank entry' toast", () => {
    s().forkItemToNewBankItem(sectionId, "det");
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].message).toBe("Forked to a new bank entry");
  });

  it("undo restores the exact raw item and removes the new entry (detached)", () => {
    const before = structuredClone(raw(sectionId, "det")!);
    const bankBefore = s().bank;
    s().forkItemToNewBankItem(sectionId, "det");
    toasts()[0].undo!();
    expect(raw(sectionId, "det")).toEqual(before);
    expect(s().bank).toEqual(bankBefore);
  });

  it("undo restores the exact raw item and removes the new entry (linked)", () => {
    const before = structuredClone(raw(sectionId, "lnk")!);
    s().forkItemToNewBankItem(sectionId, "lnk");
    toasts()[0].undo!();
    expect(raw(sectionId, "lnk")).toEqual(before);
    expect(s().bank).toHaveLength(2);
  });

  it("undo keeps the new entry when another item references it", () => {
    const id = s().forkItemToNewBankItem(sectionId, "det")!;
    s().addItemFromBank(sectionId, id);
    const bank = s().bank;
    toasts()[0].undo!();
    expect(raw(sectionId, "det")!.heading).toBe("Local Co");
    expect(s().bank).toBe(bank);
    expect(s().bank.some((b) => b.id === id)).toBe(true);
  });

  it("undo is a no-op once the item is gone", () => {
    s().forkItemToNewBankItem(sectionId, "det");
    const undo = toasts()[0].undo!;
    s().deleteItem(sectionId, "det");
    const { variants, bank } = s();
    undo();
    expect(s().variants).toBe(variants);
    expect(s().bank).toBe(bank);
  });
});
