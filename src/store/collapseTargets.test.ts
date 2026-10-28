import { describe, expect, it } from "vitest";
import { collapseTargets } from "./collapseTargets";
import type { Item, Resume, Section, SectionKind } from "./schema";

function item(id: string): Item {
  return { id, bullets: [] };
}

function section(id: string, items: Item[], kind: SectionKind = "experience"): Section {
  return { id, kind, title: id, items };
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

describe("collapseTargets", () => {
  it("returns every section id and every item id across all sections", () => {
    const r = resume([
      section("s1", [item("i1"), item("i2")]),
      section("s2", [item("i3")]),
    ]);

    expect(collapseTargets(r)).toEqual({
      sectionIds: ["s1", "s2"],
      itemIds: ["i1", "i2", "i3"],
    });
  });

  it("includes sections with no items and handles a resume with no sections", () => {
    expect(collapseTargets(resume([section("s1", [])]))).toEqual({
      sectionIds: ["s1"],
      itemIds: [],
    });
    expect(collapseTargets(resume([]))).toEqual({ sectionIds: [], itemIds: [] });
  });
});
