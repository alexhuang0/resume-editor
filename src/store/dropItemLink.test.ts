// Task 7.9: dropItemLink + isOrphaned (design §4.2 orphan safety net, Req 6.3).
import { beforeEach, describe, expect, it } from "vitest";
import { isOrphaned } from "./resolve";
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

const entry: BankItem = {
  id: "bank1",
  kind: "experience",
  heading: "Bank Co",
  bullets: [{ id: "bb1", text: "one" }],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

let sectionId: string;
let otherSectionId: string;

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
  const seed = makeSeedResume("Test");
  sectionId = seed.sections[0].id;
  otherSectionId = seed.sections[1].id;
  seed.sections[0].items = [
    {
      id: "orph",
      hidden: true,
      link: { bankId: "gone" },
      hiddenBulletIds: ["x"],
      bulletOrder: ["y", "x"],
      heading: "Typed while orphaned",
      bullets: [{ id: "t1", text: "typed" }],
    },
    {
      id: "detOrph",
      link: { bankId: "gone", detached: true },
      heading: "Detached copy",
      bullets: [{ id: "d1", text: "d", hidden: true }],
    },
    { id: "linked", link: { bankId: "bank1" }, bullets: [] },
    {
      id: "detOk",
      link: { bankId: "bank1", detached: true },
      heading: "Detached ok",
      bullets: [],
    },
    { id: "loc", heading: "local", bullets: [{ id: "l1", text: "l" }] },
  ];
  useResumeStore.setState({
    variants: [seed],
    currentVariantId: seed.id,
    bank: [entry],
  });
});

describe("isOrphaned", () => {
  const bank = [entry];
  it("is true for linked or detached items whose entry is missing", () => {
    expect(isOrphaned({ id: "a", link: { bankId: "gone" }, bullets: [] }, bank)).toBe(true);
    expect(
      isOrphaned({ id: "a", link: { bankId: "gone", detached: true }, bullets: [] }, bank)
    ).toBe(true);
    expect(isOrphaned({ id: "a", link: { bankId: "bank1" }, bullets: [] }, [])).toBe(true);
  });
  it("is false when the entry exists, and for local items", () => {
    expect(isOrphaned({ id: "a", link: { bankId: "bank1" }, bullets: [] }, bank)).toBe(false);
    expect(
      isOrphaned({ id: "a", link: { bankId: "bank1", detached: true }, bullets: [] }, bank)
    ).toBe(false);
    expect(isOrphaned({ id: "a", bullets: [] }, bank)).toBe(false);
    expect(isOrphaned({ id: "a", bullets: [] }, [])).toBe(false);
  });
});

describe("dropItemLink", () => {
  it("turns a linked orphan into a local item, keeping typed wording", () => {
    s().dropItemLink(sectionId, "orph");
    expect(raw(sectionId, "orph")).toEqual({
      id: "orph",
      hidden: true,
      heading: "Typed while orphaned",
      bullets: [{ id: "t1", text: "typed" }],
    });
    for (const k of ["link", "hiddenBulletIds", "bulletOrder"]) {
      expect(k in raw(sectionId, "orph")!).toBe(false);
    }
  });

  it("turns a detached orphan into a local item", () => {
    s().dropItemLink(sectionId, "detOrph");
    expect(raw(sectionId, "detOrph")).toEqual({
      id: "detOrph",
      heading: "Detached copy",
      bullets: [{ id: "d1", text: "d", hidden: true }],
    });
  });

  it("keeps a bare linked orphan as an empty local item", () => {
    useResumeStore.setState({ bank: [] });
    s().dropItemLink(sectionId, "linked");
    expect(raw(sectionId, "linked")).toEqual({ id: "linked", bullets: [] });
  });

  it("pushes a 'Link dropped' toast", () => {
    s().dropItemLink(sectionId, "orph");
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].message).toBe("Link dropped");
  });

  it("undo restores the exact raw item", () => {
    const before = structuredClone(raw(sectionId, "orph")!);
    const beforeDet = structuredClone(raw(sectionId, "detOrph")!);
    s().dropItemLink(sectionId, "orph");
    s().dropItemLink(sectionId, "detOrph");
    toasts()[1].undo!();
    expect(raw(sectionId, "detOrph")).toEqual(beforeDet);
    toasts()[0].undo!();
    expect(raw(sectionId, "orph")).toEqual(before);
  });

  it("undo finds the item after it moved to another section, and no-ops if gone", () => {
    const before = structuredClone(raw(sectionId, "orph")!);
    s().dropItemLink(sectionId, "orph");
    s().dropItemLink(sectionId, "detOrph");

    // Move "orph" to another section of the same variant.
    const moved = raw(sectionId, "orph")!;
    useResumeStore.setState((st) => ({
      variants: st.variants.map((v) => ({
        ...v,
        sections: v.sections.map((sec) =>
          sec.id === sectionId
            ? { ...sec, items: sec.items.filter((i) => i.id !== "orph") }
            : sec.id === otherSectionId
              ? { ...sec, items: [...sec.items, moved] }
              : sec
        ),
      })),
    }));
    toasts()[0].undo!();
    expect(raw(otherSectionId, "orph")).toEqual(before);

    // Delete "detOrph", then its undo must not resurrect it.
    s().deleteItem(sectionId, "detOrph");
    const { variants } = s();
    toasts()[1].undo!();
    expect(s().variants).toBe(variants);
  });

  it("is a no-op without a toast for local items and non-orphans", () => {
    const variants = s().variants;
    s().dropItemLink(sectionId, "loc");
    s().dropItemLink(sectionId, "linked");
    s().dropItemLink(sectionId, "detOk");
    s().dropItemLink(sectionId, "nope");
    s().dropItemLink("nope", "orph");
    expect(s().variants).toBe(variants);
    expect(toasts()).toHaveLength(0);
  });
});
