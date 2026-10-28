import { describe, expect, it } from "vitest";
import { projectItemsToImport } from "./importProjection";
import type { Resume } from "./schema";

function variant(sections: Resume["sections"]): Resume {
  return {
    schemaVersion: 3,
    id: "v1",
    name: "Test",
    updatedAt: "2024-01-01T00:00:00.000Z",
    header: { fullName: "A", fields: [] },
    sections,
  };
}

const v: Resume = variant([
  {
    id: "s1",
    kind: "experience",
    title: "Experience",
    items: [
      { id: "i1", heading: "Acme", bullets: [] }, // local
      { id: "i2", link: { bankId: "bk1" }, bullets: [] }, // linked
      { id: "i3", heading: "Globex", bullets: [] }, // local
      { id: "i4", link: { bankId: "bk2", detached: true }, bullets: [] }, // detached
    ],
  },
  {
    id: "s2",
    kind: "projects",
    title: "Projects",
    items: [
      { id: "p1", bullets: [] }, // local, no heading -> Untitled projects
      { id: "p2", heading: "Side", bullets: [] }, // local
    ],
  },
]);

describe("projectItemsToImport", () => {
  it("lists only local items, in encounter order, across selected sections", () => {
    const out = projectItemsToImport(v, ["s1", "s2"]);
    expect(out.map((e) => e.itemId)).toEqual(["i1", "i3", "p1", "p2"]);
    expect(out.map((e) => e.sectionId)).toEqual(["s1", "s1", "s2", "s2"]);
  });

  it("excludes linked and detached items", () => {
    const out = projectItemsToImport(v, ["s1"]);
    expect(out.map((e) => e.itemId)).toEqual(["i1", "i3"]);
  });

  it("only projects selected sections", () => {
    const out = projectItemsToImport(v, ["s2"]);
    expect(out.map((e) => e.itemId)).toEqual(["p1", "p2"]);
  });

  it("derives kind from the section and label like the bank list", () => {
    const out = projectItemsToImport(v, ["s1", "s2"]);
    expect(out).toEqual([
      { sectionId: "s1", itemId: "i1", kind: "experience", label: "Acme" },
      { sectionId: "s1", itemId: "i3", kind: "experience", label: "Globex" },
      { sectionId: "s2", itemId: "p1", kind: "projects", label: "Untitled projects" },
      { sectionId: "s2", itemId: "p2", kind: "projects", label: "Side" },
    ]);
  });

  it("is empty for an unknown/undefined variant", () => {
    expect(projectItemsToImport(undefined, ["s1"])).toEqual([]);
  });

  it("is empty for an empty selection", () => {
    expect(projectItemsToImport(v, [])).toEqual([]);
  });

  it("is empty for a section id not in the variant", () => {
    expect(projectItemsToImport(v, ["nope"])).toEqual([]);
  });

  it("is empty for sections with no local items", () => {
    const linkedOnly = variant([
      {
        id: "s1",
        kind: "experience",
        title: "Experience",
        items: [
          { id: "i1", link: { bankId: "bk1" }, bullets: [] },
          { id: "i2", link: { bankId: "bk2", detached: true }, bullets: [] },
        ],
      },
    ]);
    expect(projectItemsToImport(linkedOnly, ["s1"])).toEqual([]);
  });

  it("does not mutate the variant", () => {
    const snapshot = JSON.parse(JSON.stringify(v));
    projectItemsToImport(v, ["s1", "s2"]);
    expect(v).toEqual(snapshot);
  });
});
