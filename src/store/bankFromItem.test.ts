// Task 7.4: bankEntryFromItem (pure helper shared by promote, fork and import).
import { describe, expect, it } from "vitest";
import { bankEntryFromItem } from "./bankFromItem";
import type { Item } from "./schema";

const item = (): Item => ({
  id: "i1",
  hidden: true,
  heading: "Acme",
  subheading: "Engineer",
  location: "",
  dateRange: undefined,
  bullets: [
    { id: "b1", text: "one" },
    { id: "b2", text: "two", hidden: true },
  ],
});

describe("bankEntryFromItem", () => {
  it("copies content, takes kind from the caller and sets bank metadata", () => {
    const src = item();
    const e = bankEntryFromItem(src, "projects");
    expect(e.kind).toBe("projects");
    expect(e.heading).toBe("Acme");
    expect(e.subheading).toBe("Engineer");
    expect(e.location).toBe("");
    expect(e.dateRange).toBeUndefined();
    expect(e.id.startsWith("bk_")).toBe(true);
    expect(e.id).not.toBe(src.id);
    expect(Number.isNaN(Date.parse(e.updatedAt))).toBe(false);
    expect("label" in e).toBe(false);
    expect("hidden" in e).toBe(false);
    expect("link" in e).toBe(false);
  });

  it("keeps bullet ids and hidden flags but deep-copies the bullets", () => {
    const src = item();
    const e = bankEntryFromItem(src, "experience");
    expect(e.bullets).toEqual(src.bullets);
    expect(e.bullets).not.toBe(src.bullets);
    e.bullets.forEach((b, k) => expect(b).not.toBe(src.bullets[k]));
  });

  it("does not mutate the input and mints a new id each call", () => {
    const src = item();
    const before = structuredClone(src);
    const a = bankEntryFromItem(src, "custom");
    const b = bankEntryFromItem(src, "custom");
    expect(src).toEqual(before);
    expect(a.id).not.toBe(b.id);
  });

  it("handles an item with no bullets", () => {
    expect(bankEntryFromItem({ id: "x", bullets: [] }, "skills").bullets).toEqual([]);
  });
});
