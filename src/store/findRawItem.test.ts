import { describe, expect, it } from "vitest";
import { findRawItem } from "./findRawItem";
import type { Item, Resume } from "./schema";

const linked: Item = { id: "i1", link: { bankId: "bk1" }, bullets: [] };
const local: Item = { id: "i2", heading: "Local", bullets: [{ id: "b1", text: "x" }] };

const variant: Resume = {
  schemaVersion: 3,
  id: "v1",
  name: "Test",
  updatedAt: "2024-01-01T00:00:00.000Z",
  header: { fullName: "A", fields: [] },
  sections: [
    { id: "s1", kind: "experience", title: "Exp", items: [linked, local] },
    { id: "s2", kind: "projects", title: "Proj", items: [] },
  ],
};

describe("findRawItem", () => {
  it("returns the very object stored in the variant (reference-stable)", () => {
    expect(findRawItem(variant, "s1", "i1")).toBe(linked);
    expect(findRawItem(variant, "s1", "i2")).toBe(local);
  });

  it("keeps the raw link state and empty wording of a linked item", () => {
    const raw = findRawItem(variant, "s1", "i1");
    expect(raw?.link).toEqual({ bankId: "bk1" });
    expect(raw?.bullets).toEqual([]);
  });

  it("returns undefined for a missing variant, section or item", () => {
    expect(findRawItem(undefined, "s1", "i1")).toBeUndefined();
    expect(findRawItem(variant, "nope", "i1")).toBeUndefined();
    expect(findRawItem(variant, "s2", "i1")).toBeUndefined();
    expect(findRawItem(variant, "s1", "nope")).toBeUndefined();
  });
});
