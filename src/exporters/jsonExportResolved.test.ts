import { describe, expect, it } from "vitest";
import { libraryJsonPayload, resumeJsonPayload, stripOrphanFlags } from "./importExport";
import { resolveResume } from "../store/resolve";
import type { ResolvedItem } from "../store/resolve";
import { CURRENT_SCHEMA_VERSION } from "../store/schema";
import type { BankItem, Item, Resume } from "../store/schema";

/**
 * Task 6.9: single-variant JSON export inlines linked items from the bank,
 * while the library export keeps writing raw variants plus the bank.
 * Task 9.1 (below): the `orphaned` UI flag is stripped from the artifact.
 *
 * **Validates: Requirements 6.5, 10.1**
 */

const bankEntry: BankItem = {
  id: "bank1",
  heading: "Bank Heading",
  subheading: "Bank Sub",
  location: "Remote",
  dateRange: "2020 - 2022",
  bullets: [
    { id: "b1", text: "Bank bullet one" },
    { id: "b2", text: "Bank bullet two" },
  ],
} as BankItem;

const linked: Item = {
  id: "i-linked",
  bullets: [],
  link: { bankId: "bank1" },
  hiddenBulletIds: ["b2"],
};

const local: Item = {
  id: "i-local",
  heading: "Local Heading",
  bullets: [{ id: "lb1", text: "Local bullet" }],
};

function variant(items: Item[]): Resume {
  return {
    id: "r1",
    name: "V",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    header: { name: "N", fields: [] },
    sections: [{ id: "s1", kind: "experience", title: "Experience", items }],
  } as unknown as Resume;
}

describe("resumeJsonPayload (single-variant export)", () => {
  it("inlines bank content for a linked item and retains link and overlay fields", () => {
    const out = JSON.parse(resumeJsonPayload(variant([linked, local]), [bankEntry]));
    const [a, b] = out.sections[0].items;

    expect(a.heading).toBe("Bank Heading");
    expect(a.subheading).toBe("Bank Sub");
    expect(a.bullets.map((x: { text: string }) => x.text)).toEqual(["Bank bullet one"]);
    expect(a.link).toEqual({ bankId: "bank1" });
    expect(a.hiddenBulletIds).toEqual(["b2"]);
    expect(b).toEqual(local);
  });

  it("serializes a variant with no links identically to JSON.stringify", () => {
    const v = variant([local]);
    expect(resumeJsonPayload(v, [bankEntry])).toBe(JSON.stringify(v, null, 2));
    expect(resumeJsonPayload(v)).toBe(JSON.stringify(v, null, 2));
  });
});

/**
 * Task 9.1: the resolver's runtime-only `orphaned` flag stays out of the
 * artifact, while `link`, `hiddenBulletIds` and `bulletOrder` ride along.
 *
 * **Validates: Requirements 10.1**
 */
describe("resumeJsonPayload (9.1: orphaned flag stripped, overlay retained)", () => {
  const overlayLinked: Item = {
    id: "i-overlay",
    bullets: [],
    link: { bankId: "bank1" },
    hiddenBulletIds: ["b1"],
    bulletOrder: ["b2", "b1"],
  };
  const orphan: Item = {
    id: "i-orphan",
    bullets: [],
    link: { bankId: "gone" },
    hiddenBulletIds: ["x"],
    bulletOrder: ["y", "x"],
  };

  it("omits `orphaned` for an item whose bank entry is missing", () => {
    const v = variant([orphan]);
    // Precondition: the resolver does flag it, so the strip is doing real work.
    const resolved = resolveResume(v, [bankEntry]);
    expect((resolved.sections[0].items[0] as ResolvedItem).orphaned).toBe(true);

    const payload = resumeJsonPayload(v, [bankEntry]);
    expect(payload).not.toContain("orphaned");

    const [item] = JSON.parse(payload).sections[0].items;
    expect("orphaned" in item).toBe(false);
    expect(item.link).toEqual({ bankId: "gone" });
    expect(item.hiddenBulletIds).toEqual(["x"]);
    expect(item.bulletOrder).toEqual(["y", "x"]);
  });

  it("keeps link, hiddenBulletIds and bulletOrder on a resolvable linked item", () => {
    const out = JSON.parse(resumeJsonPayload(variant([overlayLinked]), [bankEntry]));
    const [item] = out.sections[0].items;

    expect("orphaned" in item).toBe(false);
    expect(item.link).toEqual({ bankId: "bank1" });
    expect(item.hiddenBulletIds).toEqual(["b1"]);
    expect(item.bulletOrder).toEqual(["b2", "b1"]);
    // Overlay applied to the inlined wording: b1 hidden, so only b2 remains.
    expect(item.bullets.map((x: { id: string }) => x.id)).toEqual(["b2"]);
  });

  it("strips only the orphan and leaves siblings in a mixed section untouched", () => {
    const out = JSON.parse(
      resumeJsonPayload(variant([local, orphan, overlayLinked]), [bankEntry])
    );
    const [a, b, c] = out.sections[0].items;

    expect(a).toEqual(local);
    expect(b.id).toBe("i-orphan");
    expect("orphaned" in b).toBe(false);
    expect(c.id).toBe("i-overlay");
    expect(c.heading).toBe("Bank Heading");
  });

  it("does not mutate its input", () => {
    const v = variant([orphan]);
    const before = JSON.stringify(v);
    resumeJsonPayload(v, []);
    expect(JSON.stringify(v)).toBe(before);
  });
});

describe("stripOrphanFlags", () => {
  it("returns the same object when no item carries the flag", () => {
    const v = variant([local]);
    expect(stripOrphanFlags(v)).toBe(v);
  });

  it("rebuilds only the affected path and drops just the flag", () => {
    const flagged = { ...orphanItem(), orphaned: true } as Item;
    const v = variant([local, flagged]);
    const out = stripOrphanFlags(v);

    expect(out).not.toBe(v);
    expect(out.sections[0].items[0]).toBe(local);
    expect(out.sections[0].items[1]).toEqual(orphanItem());
    expect("orphaned" in out.sections[0].items[1]).toBe(false);
    // Input untouched.
    expect((v.sections[0].items[1] as Item & { orphaned?: boolean }).orphaned).toBe(true);
  });
});

function orphanItem(): Item {
  return { id: "i-orphan", bullets: [], link: { bankId: "gone" } };
}

describe("libraryJsonPayload (library export)", () => {
  it("keeps linked items raw (empty bullets) and includes the bank", () => {
    const out = JSON.parse(libraryJsonPayload([variant([linked])], [bankEntry]));
    const item = out.variants[0].sections[0].items[0];

    expect(item.bullets).toEqual([]);
    expect(item.heading).toBeUndefined();
    expect(item.link).toEqual({ bankId: "bank1" });
    expect(out.bank).toHaveLength(1);
    expect(out.bank[0].id).toBe("bank1");
  });
});
