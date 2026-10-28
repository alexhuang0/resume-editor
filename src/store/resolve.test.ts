import { describe, expect, it } from "vitest";
import { linkState, resolveItem, resolveResume, type ResolvedItem } from "./resolve";
import type { BankItem, Item, Resume, Section } from "./schema";

const bankEntry: BankItem = {
  id: "bank1",
  kind: "experience",
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
};
const bankById = new Map([[bankEntry.id, bankEntry]]);

const local: Item = { id: "i1", heading: "Own", bullets: [{ id: "x", text: "own" }] };

function resume(sections: Section[]): Resume {
  return {
    schemaVersion: 3,
    id: "r",
    name: "r",
    updatedAt: "2024-01-01T00:00:00.000Z",
    header: { fullName: "N", fields: [] },
    sections,
  };
}

describe("linkState", () => {
  it("classifies local, detached, linked", () => {
    expect(linkState(local)).toBe("local");
    expect(linkState({ ...local, link: { bankId: "bank1", detached: true } })).toBe("detached");
    expect(linkState({ ...local, link: { bankId: "bank1" } })).toBe("linked");
  });
});

describe("resolveItem", () => {
  it("returns local and detached items unchanged (same reference)", () => {
    const detached: Item = { ...local, link: { bankId: "bank1", detached: true } };
    expect(resolveItem(local, bankById)).toBe(local);
    expect(resolveItem(detached, bankById)).toBe(detached);
  });

  it("takes wording from the bank and applies the overlay", () => {
    const linked: Item = {
      id: "i2",
      hidden: true,
      bullets: [],
      link: { bankId: "bank1" },
      hiddenBulletIds: ["b2"],
      bulletOrder: ["b3", "b1"],
    };
    const out = resolveItem(linked, bankById);
    expect(out.id).toBe("i2");
    expect(out.hidden).toBe(true);
    expect(out.heading).toBe("Bank Co");
    expect(out.bullets.map((b) => b.id)).toEqual(["b3", "b1"]);
    expect(out.link).toEqual({ bankId: "bank1" });
    expect(out.hiddenBulletIds).toEqual(["b2"]);
    expect(out.bulletOrder).toEqual(["b3", "b1"]);
    expect(bankEntry.bullets.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("appends bullets unknown to bulletOrder", () => {
    const linked: Item = { id: "i", bullets: [], link: { bankId: "bank1" }, bulletOrder: ["b3"] };
    expect(resolveItem(linked, bankById).bullets.map((b) => b.id)).toEqual(["b3", "b1", "b2"]);
  });

  it("flags a missing bank entry as orphaned without throwing", () => {
    const linked: Item = { id: "i3", bullets: [], link: { bankId: "gone" } };
    const out = resolveItem(linked, bankById);
    expect(out.orphaned).toBe(true);
    expect(out.bullets).toEqual([]);
    expect(out.link).toEqual({ bankId: "gone" });
  });
});

describe("resolveResume", () => {
  const linked: Item = { id: "i2", bullets: [], link: { bankId: "bank1" } };

  it("returns the same variant object when nothing is linked", () => {
    const v = resume([{ id: "s", kind: "experience", title: "S", items: [local] }]);
    expect(resolveResume(v, [bankEntry])).toBe(v);
  });

  it("keeps untouched sections and rebuilds only changed ones", () => {
    const plain: Section = { id: "s1", kind: "experience", title: "A", items: [local] };
    const withLink: Section = { id: "s2", kind: "experience", title: "B", items: [linked] };
    const v = resume([plain, withLink]);
    const out = resolveResume(v, [bankEntry]);
    expect(out).not.toBe(v);
    expect(out.sections[0]).toBe(plain);
    expect(out.sections[1]).not.toBe(withLink);
    expect(out.sections[1].items[0].heading).toBe("Bank Co");
    expect(v.sections[1].items[0].heading).toBeUndefined();
  });

  it("marks orphans at runtime", () => {
    const v = resume([{ id: "s", kind: "experience", title: "S", items: [linked] }]);
    const out = resolveResume(v, []);
    expect((out.sections[0].items[0] as ResolvedItem).orphaned).toBe(true);
  });
});
