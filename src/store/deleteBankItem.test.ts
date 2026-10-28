// Task 7.8: deleteBankItem orphans references, with undo (design §4.3, §4.4, Req 7.7).
import { beforeEach, describe, expect, it } from "vitest";
import { resolveItem } from "./resolve";
import { useResumeStore } from "./resumeStore";
import { useUiStore } from "./uiStore";
import { makeSeedResume } from "./seed";
import type { BankItem, Item, Resume } from "./schema";

const makeEntry = (id = "bank1", label?: string): BankItem => ({
  id,
  kind: "experience",
  label,
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
const variant = (id: string): Resume => s().variants.find((v) => v.id === id)!;
const findItem = (v: Resume, itemId: string): Item | undefined =>
  v.sections.flatMap((x) => x.items).find((i) => i.id === itemId);

const visible = (item: Item) => ({
  heading: item.heading,
  subheading: item.subheading,
  location: item.location,
  dateRange: item.dateRange,
  bullets: item.bullets.filter((b) => !b.hidden).map((b) => b.text),
});

let main: Resume;
let other: Resume;
let untouched: Resume;
let otherEntry: BankItem;

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
  main = makeSeedResume("Main");
  other = makeSeedResume("Other");
  untouched = makeSeedResume("Untouched");
  otherEntry = makeEntry("bank2");

  main.sections[0].items = [
    {
      id: "lin",
      hidden: true,
      link: { bankId: "bank1" },
      bullets: [],
      hiddenBulletIds: ["b2"],
      bulletOrder: ["b3", "b1"],
    },
    { id: "det", link: { bankId: "bank1", detached: true }, heading: "My own", bullets: [{ id: "d1", text: "mine" }] },
    { id: "elsewhere", link: { bankId: "bank2" }, bullets: [] },
    { id: "loc", heading: "local", bullets: [{ id: "x", text: "y" }] },
  ];
  other.sections[0].items = [{ id: "lin2", link: { bankId: "bank1" }, bullets: [] }];
  // Second section of `other` references it too.
  other.sections[1].items = [
    { id: "lin3", link: { bankId: "bank1" }, bullets: [], hiddenBulletIds: ["b1"] },
  ];

  useResumeStore.setState({
    variants: [main, other, untouched],
    currentVariantId: main.id,
    bank: [makeEntry("bank0"), makeEntry("bank1", "Acme"), otherEntry],
  });
});

describe("deleteBankItem", () => {
  it("removes an unreferenced entry without touching variants, toast has no count", () => {
    const before = s().variants;
    const removed = s().deleteBankItem("bank0");
    expect(removed?.id).toBe("bank0");
    expect(s().variants).toBe(before);
    expect(toasts()[0].message).toBe('Bank entry "Bank Co" deleted');
  });

  it("returns null for an unknown id and pushes nothing", () => {
    expect(s().deleteBankItem("nope")).toBeNull();
    expect(toasts()).toHaveLength(0);
  });

  it("bakes a linked item into a local one with its rendered content intact", () => {
    const entry = s().bank.find((b) => b.id === "bank1")!;
    const rawBefore = findItem(variant(main.id), "lin")!;
    const resolvedBefore = resolveItem(rawBefore, new Map([[entry.id, entry]]));

    s().deleteBankItem("bank1");

    const after = findItem(variant(main.id), "lin")!;
    expect(after.link).toBeUndefined();
    for (const k of ["link", "hiddenBulletIds", "bulletOrder"]) {
      expect(k in after).toBe(false);
    }
    expect(after.hidden).toBe(true);
    expect(visible(after)).toEqual(visible(resolvedBefore));
    // Order applied, overlay-hidden bullet kept but flagged.
    expect(after.bullets.map((b) => b.id)).toEqual(["b3", "b1", "b2"]);
    expect(after.bullets.find((b) => b.id === "b2")?.hidden).toBe(true);
  });

  it("orphans references across all variants and sections; detached keeps its wording", () => {
    s().deleteBankItem("bank1");

    const det = findItem(variant(main.id), "det")!;
    expect("link" in det).toBe(false);
    expect(det.heading).toBe("My own");
    expect(det.bullets).toEqual([{ id: "d1", text: "mine" }]);

    for (const id of ["lin2", "lin3"]) {
      const it = findItem(variant(other.id), id)!;
      expect("link" in it).toBe(false);
      expect(it.heading).toBe("Bank Co");
      expect(it.bullets.length).toBe(3);
    }
    expect(
      findItem(variant(other.id), "lin3")!.bullets.find((b) => b.id === "b1")?.hidden
    ).toBe(true);

    expect(s().bank.map((b) => b.id)).toEqual(["bank0", "bank2"]);
  });

  it("leaves other links, local items and unaffected variants as the same objects", () => {
    const mainBefore = variant(main.id);
    s().deleteBankItem("bank1");

    const mainAfter = variant(main.id);
    expect(mainAfter).not.toBe(mainBefore);
    expect(findItem(mainAfter, "elsewhere")).toBe(findItem(mainBefore, "elsewhere"));
    expect(findItem(mainAfter, "loc")).toBe(findItem(mainBefore, "loc"));
    expect(variant(untouched.id)).toBe(untouched);
    // A section that had no reference keeps identity too.
    expect(mainAfter.sections[1]).toBe(mainBefore.sections[1]);
  });

  it("pushes a pluralized undo toast", () => {
    s().deleteBankItem("bank1");
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].message).toBe(
      'Bank entry "Acme" deleted — 4 items kept as local copies'
    );
    expect(typeof toasts()[0].undo).toBe("function");

    useUiStore.setState({ toasts: [] });
    s().deleteBankItem("bank2");
    expect(toasts()[0].message).toBe(
      'Bank entry "Bank Co" deleted — 1 item kept as local copies'
    );
  });

  it("undo restores the entry at its index and the exact raw items", () => {
    const variantsBefore = s().variants;
    const rawBefore = {
      lin: findItem(variant(main.id), "lin"),
      det: findItem(variant(main.id), "det"),
      lin2: findItem(variant(other.id), "lin2"),
      lin3: findItem(variant(other.id), "lin3"),
    };
    s().deleteBankItem("bank1");
    toasts()[0].undo!();

    expect(s().bank.map((b) => b.id)).toEqual(["bank0", "bank1", "bank2"]);
    expect(findItem(variant(main.id), "lin")).toEqual(rawBefore.lin);
    expect(findItem(variant(main.id), "det")).toEqual(rawBefore.det);
    expect(findItem(variant(other.id), "lin2")).toEqual(rawBefore.lin2);
    expect(findItem(variant(other.id), "lin3")).toEqual(rawBefore.lin3);
    expect(variant(untouched.id)).toBe(variantsBefore[2]);
    expect(toasts()).toHaveLength(1); // undo pushes no new toast
  });

  it("undo is a no-op when the entry id is already in the bank", () => {
    s().deleteBankItem("bank1");
    const undo = toasts()[0].undo!;
    useResumeStore.setState({ bank: [...s().bank, makeEntry("bank1", "Recreated")] });
    const before = s();
    undo();
    expect(s().bank).toBe(before.bank);
    expect(s().variants).toBe(before.variants);
  });

  it("undo skips items that no longer exist", () => {
    s().deleteBankItem("bank1");
    const undo = toasts()[0].undo!;
    useResumeStore.setState({
      variants: s().variants.map((v) =>
        v.id === main.id
          ? { ...v, sections: v.sections.map((x) => ({ ...x, items: x.items.filter((i) => i.id !== "lin") })) }
          : v
      ),
    });
    undo();
    expect(findItem(variant(main.id), "lin")).toBeUndefined();
    expect(findItem(variant(main.id), "det")?.link).toEqual({ bankId: "bank1", detached: true });
  });
});
