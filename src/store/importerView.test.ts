import { describe, expect, it } from "vitest";
import {
  importCount,
  importedToastMessage,
  importerSections,
} from "./importerView";
import type { Item, Resume, Section, SectionKind } from "./schema";

function item(id: string, link?: Item["link"]): Item {
  return { id, bullets: [], link };
}

function section(id: string, items: Item[], kind: SectionKind = "experience"): Section {
  return { id, kind, title: `${id} title`, items };
}

function resume(sections: Section[]): Resume {
  return {
    schemaVersion: 3,
    id: "v1",
    name: "Test",
    updatedAt: "2024-01-01T00:00:00.000Z",
    header: { fullName: "A", fields: [] },
    sections,
  };
}

describe("importerSections", () => {
  it("lists every section with title, kind, and importable (local-only) count", () => {
    const r = resume([
      section("s1", [item("a"), item("b", { bankId: "x" })], "experience"),
      section("s2", [item("c")], "projects"),
    ]);

    expect(importerSections(r)).toEqual([
      { id: "s1", title: "s1 title", kind: "experience", importableCount: 1 },
      { id: "s2", title: "s2 title", kind: "projects", importableCount: 1 },
    ]);
  });

  it("counts only local items — linked and detached are not importable", () => {
    const r = resume([
      section("s1", [
        item("local"),
        item("linked", { bankId: "x" }),
        item("detached", { bankId: "y", detached: true }),
      ]),
    ]);

    expect(importerSections(r)[0].importableCount).toBe(1);
  });

  it("includes sections with no importable items as zero", () => {
    const r = resume([section("s1", [item("linked", { bankId: "x" })])]);
    expect(importerSections(r)[0].importableCount).toBe(0);
  });

  it("returns an empty list for an undefined variant", () => {
    expect(importerSections(undefined)).toEqual([]);
  });
});

describe("importCount", () => {
  it("matches the number of local items across the selected sections", () => {
    const r = resume([
      section("s1", [item("a"), item("b")]),
      section("s2", [item("c")]),
    ]);

    expect(importCount(r, ["s1"])).toBe(2);
    expect(importCount(r, ["s1", "s2"])).toBe(3);
  });

  it("is zero for no selection, unknown sections, or an undefined variant", () => {
    const r = resume([section("s1", [item("a")])]);
    expect(importCount(r, [])).toBe(0);
    expect(importCount(r, ["nope"])).toBe(0);
    expect(importCount(undefined, ["s1"])).toBe(0);
  });

  // The "second run proposes nothing" guarantee (task 10.4, Req 11.2): after a
  // section is imported every item carries a link, so re-selecting that same
  // section — importableCount 0 — must contribute no entries.
  it("is zero for a selected section whose items are all already linked", () => {
    const r = resume([
      section("s1", [
        item("linked", { bankId: "x" }),
        item("detached", { bankId: "y", detached: true }),
      ]),
    ]);
    expect(importerSections(r)[0].importableCount).toBe(0);
    expect(importCount(r, ["s1"])).toBe(0);
  });

  // Per-section subset (task 10.4): selecting a strict subset of sections
  // imports only that subset, so a user can import one section at a later run.
  it("counts only the selected subset of sections", () => {
    const r = resume([
      section("exp", [item("a"), item("b")]),
      section("proj", [item("c")]),
    ]);
    expect(importCount(r, ["exp"])).toBe(2);
    expect(importCount(r, ["proj"])).toBe(1);
  });
});

describe("importedToastMessage", () => {
  it("uses the singular noun for exactly one", () => {
    expect(importedToastMessage(1)).toBe("Imported 1 item to the bank");
  });

  it("uses the plural noun for zero and many", () => {
    expect(importedToastMessage(0)).toBe("Imported 0 items to the bank");
    expect(importedToastMessage(5)).toBe("Imported 5 items to the bank");
  });
});
