// Task 10.1: importItemsToBank — bulk promote for the guided bank bootstrap
// (design §4.3, Req 11.1, 11.2). Mirrors promoteItemToBank per item: creates a
// bank entry from every LOCAL item in the selected sections, relinks it and
// clears its local wording. Skips items that already carry a link.
import { beforeEach, describe, expect, it } from "vitest";
import { resolveItem } from "./resolve";
import { useResumeStore } from "./resumeStore";
import { useUiStore } from "./uiStore";
import { makeSeedResume } from "./seed";
import type { BankItem, Item, Resume } from "./schema";

const s = () => useResumeStore.getState();
const variantById = (id: string): Resume => s().variants.find((v) => v.id === id)!;
const raw = (variantId: string, sectionId: string, itemId: string): Item | undefined =>
  variantById(variantId)
    .sections.find((x) => x.id === sectionId)
    ?.items.find((i) => i.id === itemId);
const resolveRaw = (item: Item, bank = s().bank) =>
  resolveItem(item, new Map(bank.map((b) => [b.id, b])));

const existing: BankItem = {
  id: "bank1",
  kind: "experience",
  heading: "Bank Co",
  bullets: [{ id: "bb1", text: "bank" }],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

let variantId: string;
let otherVariantId: string;
let expSectionId: string; // experience, has local + linked + detached items
let projSectionId: string; // projects, local items only
let skillsSectionId: string;
let otherSectionId: string; // the other variant's section

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
  const seed = makeSeedResume("Test");
  const other = makeSeedResume("Other");
  variantId = seed.id;
  otherVariantId = other.id;
  expSectionId = seed.sections[0].id;
  projSectionId = "sec-proj";
  skillsSectionId = "sec-skills";
  otherSectionId = other.sections[0].id;

  seed.sections[0].kind = "experience";
  seed.sections[0].items = [
    {
      id: "e-local",
      heading: "Acme",
      subheading: "Engineer",
      location: "NYC",
      dateRange: "2020",
      bullets: [
        { id: "x1", text: "one" },
        { id: "x2", text: "two", hidden: true },
        { id: "x3", text: "three" },
      ],
    },
    { id: "e-linked", link: { bankId: "bank1" }, bullets: [] },
    {
      id: "e-detached",
      link: { bankId: "bank1", detached: true },
      heading: "Detached Co",
      bullets: [{ id: "d1", text: "d" }],
    },
  ];
  seed.sections.push({
    id: projSectionId,
    kind: "projects",
    title: "Projects",
    items: [
      { id: "p1", heading: "Proj One", bullets: [{ id: "pb1", text: "pb1" }] },
      { id: "p2", heading: "Proj Two", bullets: [{ id: "pb2", text: "pb2" }] },
    ],
  });
  seed.sections.push({
    id: skillsSectionId,
    kind: "skills",
    title: "Skills",
    items: [{ id: "sk", heading: "Languages", bullets: [{ id: "sb", text: "TS, Go" }] }],
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

describe("importItemsToBank", () => {
  it("creates entries for every local item across multiple selected sections", () => {
    const ids = s().importItemsToBank(variantId, [expSectionId, projSectionId]);
    // e-local, p1, p2 are local; e-linked / e-detached are skipped.
    expect(ids).toHaveLength(3);
    expect(s().bank).toHaveLength(1 + 3); // existing + 3 new
    expect(new Set(ids).size).toBe(3); // all distinct

    const byId = new Map(s().bank.map((b) => [b.id, b]));
    const [expId, p1Id, p2Id] = ids;
    expect(byId.get(expId)!.kind).toBe("experience");
    expect(byId.get(expId)!.heading).toBe("Acme");
    expect(byId.get(p1Id)!.kind).toBe("projects");
    expect(byId.get(p1Id)!.heading).toBe("Proj One");
    expect(byId.get(p2Id)!.heading).toBe("Proj Two");
  });

  it("relinks promoted items and clears their local wording", () => {
    s().importItemsToBank(variantId, [expSectionId, projSectionId]);

    const local = raw(variantId, expSectionId, "e-local")!;
    expect(local.link?.bankId).toBeTruthy();
    expect("detached" in local.link!).toBe(false);
    expect(local.bullets).toEqual([]);
    for (const k of ["heading", "subheading", "location", "dateRange", "hiddenBulletIds", "bulletOrder"]) {
      expect(k in local).toBe(false);
    }

    const p1 = raw(variantId, projSectionId, "p1")!;
    expect(p1.link?.bankId).toBeTruthy();
    expect(p1.bullets).toEqual([]);
    expect("heading" in p1).toBe(false);
  });

  it("keeps the rendered wording unchanged through the promotion", () => {
    const before = structuredClone(raw(variantId, expSectionId, "e-local")!);
    s().importItemsToBank(variantId, [expSectionId]);
    const resolved = resolveRaw(raw(variantId, expSectionId, "e-local")!);
    expect(resolved.heading).toBe("Acme");
    expect(resolved.bullets).toEqual(before.bullets); // ids + hidden flags preserved
  });

  it("skips items that already carry a link (linked or detached)", () => {
    const linkedBefore = raw(variantId, expSectionId, "e-linked")!;
    const detachedBefore = raw(variantId, expSectionId, "e-detached")!;
    s().importItemsToBank(variantId, [expSectionId]);
    // untouched: same reference, still pointing at bank1.
    expect(raw(variantId, expSectionId, "e-linked")).toBe(linkedBefore);
    expect(raw(variantId, expSectionId, "e-detached")).toBe(detachedBefore);
    expect(raw(variantId, expSectionId, "e-linked")!.link!.bankId).toBe("bank1");
  });

  it("leaves non-selected sections and other variants untouched", () => {
    const skillsBefore = variantById(variantId).sections.find((x) => x.id === skillsSectionId)!;
    const otherVariantBefore = variantById(otherVariantId);
    s().importItemsToBank(variantId, [expSectionId]);
    // skills section object is reference-identical (not re-created).
    expect(variantById(variantId).sections.find((x) => x.id === skillsSectionId)).toBe(skillsBefore);
    // other variant object is reference-identical.
    expect(variantById(otherVariantId)).toBe(otherVariantBefore);
    expect(raw(otherVariantId, otherSectionId, "o1")!.heading).toBe("variant-b local");
  });

  it("promotes skills rows with the section's kind", () => {
    const ids = s().importItemsToBank(variantId, [skillsSectionId]);
    expect(ids).toHaveLength(1);
    const entry = s().bank.find((b) => b.id === ids[0])!;
    expect(entry.kind).toBe("skills");
    expect(entry.heading).toBe("Languages");
    expect(raw(variantId, skillsSectionId, "sk")!.bullets).toEqual([]);
    expect(resolveRaw(raw(variantId, skillsSectionId, "sk")!).bullets[0].text).toBe("TS, Go");
  });

  it("bumps the targeted variant's updatedAt", () => {
    // Pin an old timestamp so the bump is observable regardless of clock
    // resolution within the test run.
    const old = "2000-01-01T00:00:00.000Z";
    useResumeStore.setState((st) => ({
      variants: st.variants.map((v) => (v.id === variantId ? { ...v, updatedAt: old } : v)),
    }));
    s().importItemsToBank(variantId, [expSectionId]);
    const after = variantById(variantId).updatedAt;
    expect(after).not.toBe(old);
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(old));
  });

  it("a second run over the same sections is a no-op (no new bank entries)", () => {
    s().importItemsToBank(variantId, [expSectionId, projSectionId, skillsSectionId]);
    const bankAfterFirst = s().bank;
    const variantsAfterFirst = s().variants;

    const ids = s().importItemsToBank(variantId, [expSectionId, projSectionId, skillsSectionId]);
    expect(ids).toEqual([]);
    expect(s().bank).toBe(bankAfterFirst); // reference-identical: nothing changed
    expect(s().variants).toBe(variantsAfterFirst);
  });

  it("returns [] and changes nothing for an unknown variant or empty selection", () => {
    const bank = s().bank;
    const variants = s().variants;
    expect(s().importItemsToBank("nope", [expSectionId])).toEqual([]);
    expect(s().importItemsToBank(variantId, [])).toEqual([]);
    expect(s().importItemsToBank(variantId, ["nope"])).toEqual([]);
    expect(s().bank).toBe(bank);
    expect(s().variants).toBe(variants);
  });

  it("does not push a toast (the importer UI owns feedback)", () => {
    s().importItemsToBank(variantId, [expSectionId, projSectionId]);
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });
});
