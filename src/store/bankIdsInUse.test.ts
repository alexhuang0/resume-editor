import { describe, expect, it } from "vitest";
import { bankIdsInUse } from "./bankIdsInUse";
import type { Resume } from "./schema";

const variant: Resume = {
  schemaVersion: 3,
  id: "v1",
  name: "Test",
  updatedAt: "2024-01-01T00:00:00.000Z",
  header: { fullName: "A", fields: [] },
  sections: [
    {
      id: "s1",
      kind: "experience",
      title: "Exp",
      items: [
        { id: "i1", link: { bankId: "bk1" }, bullets: [] },
        { id: "i2", heading: "Local", bullets: [] },
        { id: "i3", link: { bankId: "bk2", detached: true }, bullets: [] },
      ],
    },
    {
      id: "s2",
      kind: "projects",
      title: "Proj",
      items: [{ id: "i4", link: { bankId: "bk1" }, bullets: [] }],
    },
  ],
};

describe("bankIdsInUse", () => {
  it("collects linked bank ids across all sections, including detached items", () => {
    expect(bankIdsInUse(variant)).toEqual(new Set(["bk1", "bk2"]));
  });

  it("ignores unlinked items", () => {
    expect(bankIdsInUse({ ...variant, sections: [] }).size).toBe(0);
  });

  it("returns an empty set when there is no variant", () => {
    expect(bankIdsInUse(undefined).size).toBe(0);
  });
});
