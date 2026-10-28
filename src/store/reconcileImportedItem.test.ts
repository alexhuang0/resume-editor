import { describe, expect, it } from "vitest";
import { reconcileImportedItem } from "./reconcile";
import { bakeOverlay, bakeOverlayKeepingContent, resolveItem } from "./resolve";
import { ItemSchema } from "./schema";
import type { BankItem, Item } from "./schema";

/**
 * Task 9.4: `reconcileImportedItem(imported, bankById)`, four branches in
 * order (no link, detached, bank entry missing, compare), plus the two hazards
 * flagged by the 9.3 run:
 *
 *  1. the diverged branch keeps the IMPORTED wording (`bakeOverlayKeepingContent`),
 *     it must not bake over the bank entry's;
 *  2. a raw library item (linked, no wording) must not read as diverged.
 *
 * Pure-module tests: no store, no DOM. The export-path cases (a real
 * `resumeJsonPayload` / `libraryJsonPayload` round trip) are in
 * src/exporters/reconcileImportedItem.exportPath.test.ts.
 *
 * **Validates: Requirements 10.3, 10.4, 10.5**
 */

const makeEntry = (): BankItem => ({
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
    { id: "b4", text: "four", hidden: true }, // parked bank-wide
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
});

const entry = makeEntry();
const bankById = new Map([[entry.id, entry]]);
const emptyBank = new Map<string, BankItem>();

type Overlay = Pick<Item, "hiddenBulletIds" | "bulletOrder">;

/** A RAW linked item, as the store (and a library file) holds it. */
const raw = (over: Partial<Item> = {}): Item => ({
  id: "i1",
  link: { bankId: "bank1" },
  bullets: [],
  ...over,
});

/** What a single-variant export writes for `raw(overlay)`: the resolved, inlined view. */
const inlined = (overlay: Overlay = {}, over: Partial<Item> = {}): Item => ({
  ...resolveItem(raw(overlay), bankById),
  ...over,
});

const ids = (item: Item) => item.bullets.map((b) => b.id);
const visible = (item: Item) => item.bullets.filter((b) => !b.hidden);
const WORDING_KEYS = ["heading", "subheading", "location", "dateRange"] as const;

/** Freeze recursively so any mutation throws (ES modules run in strict mode). */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    Object.values(v as object).forEach(deepFreeze);
  }
  return v;
}

describe("branch 1: no link", () => {
  it("passes the same object through, not diverged", () => {
    const local: Item = { id: "l1", heading: "Mine", bullets: [{ id: "x", text: "y" }] };
    const r = reconcileImportedItem(local, bankById);
    expect(r.item).toBe(local);
    expect(r.diverged).toBe(false);
  });

  it("does not look at the bank at all (empty bank, same result)", () => {
    const local: Item = { id: "l1", bullets: [] };
    expect(reconcileImportedItem(local, emptyBank).item).toBe(local);
  });
});

describe("branch 2: link.detached passes through untouched", () => {
  it("even when its wording equals the bank's (the identical branch would wipe it)", () => {
    const detached = inlined({}, { link: { bankId: "bank1", detached: true } });
    // Precondition: this really is what the identical branch would have matched.
    expect(detached.heading).toBe("Bank Co");
    expect(detached.bullets.length).toBeGreaterThan(0);

    const r = reconcileImportedItem(detached, bankById);
    expect(r.item).toBe(detached);
    expect(r.diverged).toBe(false);
    expect(r.item.heading).toBe("Bank Co");
    expect(ids(r.item)).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("even when its bank entry is missing (it keeps its link, nothing is dropped)", () => {
    const detached: Item = {
      id: "i1",
      heading: "Mine",
      bullets: [{ id: "m1", text: "mine" }],
      link: { bankId: "gone", detached: true },
    };
    const r = reconcileImportedItem(detached, emptyBank);
    expect(r.item).toBe(detached);
    expect(r.item.link).toEqual({ bankId: "gone", detached: true });
    expect(r.diverged).toBe(false);
  });

  it("even when its wording differs from the bank's (not counted as diverged)", () => {
    const detached = inlined({}, { heading: "Edited", link: { bankId: "bank1", detached: true } });
    const r = reconcileImportedItem(detached, bankById);
    expect(r.item).toBe(detached);
    expect(r.diverged).toBe(false);
  });

  it("leaves stray overlay keys alone", () => {
    const detached: Item = {
      id: "i1",
      heading: "Mine",
      bullets: [{ id: "b1", text: "one" }],
      link: { bankId: "bank1", detached: true },
      hiddenBulletIds: ["b2"],
      bulletOrder: ["b1"],
    };
    const r = reconcileImportedItem(detached, bankById);
    expect(r.item).toBe(detached);
    expect(r.item.hiddenBulletIds).toEqual(["b2"]);
  });

  it("a detached item with no content stays exactly as it came", () => {
    const empty: Item = { id: "i1", bullets: [], link: { bankId: "bank1", detached: true } };
    expect(reconcileImportedItem(empty, bankById).item).toBe(empty);
  });
});

describe("branch 3: bank entry missing", () => {
  it("drops link and overlay (keys omitted), keeps the content as a local item", () => {
    const item: Item = {
      id: "i1",
      hidden: true,
      heading: "Kept Heading",
      dateRange: "2019",
      bullets: [
        { id: "b1", text: "kept", hidden: true },
        { id: "b2", text: "also kept" },
      ],
      link: { bankId: "gone" },
      hiddenBulletIds: ["b9"],
      bulletOrder: ["b2", "b1"],
    };
    const r = reconcileImportedItem(item, emptyBank);
    expect(r.diverged).toBe(false);
    expect("link" in r.item).toBe(false);
    expect("hiddenBulletIds" in r.item).toBe(false);
    expect("bulletOrder" in r.item).toBe(false);
    expect(r.item).toEqual({
      id: "i1",
      hidden: true,
      heading: "Kept Heading",
      dateRange: "2019",
      bullets: [
        { id: "b1", text: "kept", hidden: true },
        { id: "b2", text: "also kept" },
      ],
    });
  });

  it("also applies when the bank has other entries but not this one", () => {
    const r = reconcileImportedItem(inlined({}, { link: { bankId: "other" } }), bankById);
    expect(r.item.link).toBeUndefined();
    expect(r.item.heading).toBe("Bank Co"); // the inlined wording is kept
    expect(r.diverged).toBe(false);
  });

  it("a RAW linked item has no content: the outcome is an empty local item, nothing invented", () => {
    const r = reconcileImportedItem(
      raw({ link: { bankId: "gone" }, hiddenBulletIds: ["b1"], bulletOrder: ["b2"] }),
      emptyBank
    );
    expect(r.item).toStrictEqual({ id: "i1", bullets: [] });
    expect(r.diverged).toBe(false);
  });

  it("is checked before the compare: a missing entry never reaches the raw/identical logic", () => {
    // Raw item, entry missing: branch 3 (link dropped), not the raw pass-through (link kept).
    expect(reconcileImportedItem(raw(), emptyBank).item.link).toBeUndefined();
  });
});

describe("branch 4: identical stays linked", () => {
  it("no overlay: link kept, wording dropped, bullets []", () => {
    const r = reconcileImportedItem(inlined(), bankById);
    expect(r.diverged).toBe(false);
    expect(r.item.link).toEqual({ bankId: "bank1" });
    expect(r.item.bullets).toStrictEqual([]);
    for (const k of WORDING_KEYS) expect(k in r.item).toBe(false);
  });

  it("returns exactly the raw linked item it was exported from", () => {
    const original = raw({ hiddenBulletIds: ["b2"], bulletOrder: ["b3", "b1"], hidden: true });
    const exported = resolveItem(original, bankById);
    const r = reconcileImportedItem(exported, bankById);
    expect(r.diverged).toBe(false);
    expect(r.item).toStrictEqual(original);
  });

  it("keeps hiddenBulletIds and bulletOrder", () => {
    const overlay: Overlay = { hiddenBulletIds: ["b2"], bulletOrder: ["b3", "b1"] };
    const exported = inlined(overlay);
    // Precondition: the inlined view is the overlay-applied one, not the raw entry.
    expect(ids(exported)).toEqual(["b3", "b1", "b4"]);

    const r = reconcileImportedItem(exported, bankById);
    expect(r.diverged).toBe(false);
    expect(r.item.hiddenBulletIds).toEqual(["b2"]);
    expect(r.item.bulletOrder).toEqual(["b3", "b1"]);
    expect(r.item.link?.detached).toBeUndefined();
    expect(r.item.bullets).toStrictEqual([]);
  });

  it("keeps id and item-level hidden", () => {
    const r = reconcileImportedItem(inlined({}, { id: "keep-me", hidden: true }), bankById);
    expect(r.item.id).toBe("keep-me");
    expect(r.item.hidden).toBe(true);
  });

  it("treats undefined and \"\" wording fields as equal (a JSON round trip may add or drop them)", () => {
    const e: BankItem = { ...makeEntry(), subheading: undefined, location: undefined };
    const map = new Map([[e.id, e]]);
    const exported: Item = {
      ...resolveItem(raw(), map),
      subheading: "",
      location: "",
    };
    expect(reconcileImportedItem(exported, map).diverged).toBe(false);
  });
});

describe("branch 4: different is kept and detached", () => {
  it.each(WORDING_KEYS)("a changed %s: detached, imported wording verbatim, diverged", (key) => {
    const edited = inlined({}, { [key]: "Edited by Claude" });
    const r = reconcileImportedItem(edited, bankById);
    expect(r.diverged).toBe(true);
    expect(r.item.link).toEqual({ bankId: "bank1", detached: true });
    expect(r.item[key]).toBe("Edited by Claude");
    for (const other of WORDING_KEYS.filter((k) => k !== key)) {
      expect(r.item[other]).toBe(entry[other]);
    }
    expect(r.item.bullets).toEqual(edited.bullets);
  });

  it("a reworded bullet is kept, not replaced by the bank's text", () => {
    const base = inlined();
    const edited: Item = {
      ...base,
      bullets: base.bullets.map((b) => (b.id === "b2" ? { ...b, text: "reworded" } : b)),
    };
    const r = reconcileImportedItem(edited, bankById);
    expect(r.diverged).toBe(true);
    expect(r.item.bullets.find((b) => b.id === "b2")?.text).toBe("reworded");
  });

  it("an added bullet and a deleted bullet are kept as the file has them", () => {
    const base = inlined();
    const added = reconcileImportedItem(
      { ...base, bullets: [...base.bullets, { id: "new", text: "brand new" }] },
      bankById
    );
    expect(added.diverged).toBe(true);
    expect(ids(added.item)).toEqual(["b1", "b2", "b3", "b4", "new"]);

    // b1 is not named in hiddenBulletIds, so its absence is a deletion, not an overlay.
    const deleted = reconcileImportedItem(
      { ...base, bullets: base.bullets.filter((b) => b.id !== "b1") },
      bankById
    );
    expect(deleted.diverged).toBe(true);
    expect(ids(deleted.item)).toEqual(["b2", "b3", "b4"]);
  });

  it("an order the file's editor changed is kept; bulletOrder is not re-applied over it", () => {
    const base = inlined({ bulletOrder: ["b3", "b2", "b1"] });
    expect(ids(base)).toEqual(["b3", "b2", "b1", "b4"]);
    const reordered: Item = { ...base, bullets: [base.bullets[2], base.bullets[0], base.bullets[1], base.bullets[3]] };
    const r = reconcileImportedItem(reordered, bankById);
    expect(r.diverged).toBe(true);
    expect(ids(r.item)).toEqual(["b1", "b3", "b2", "b4"]);
  });

  it("clears the overlay (keys omitted) and keeps id and item-level hidden", () => {
    const edited = inlined(
      { hiddenBulletIds: ["b1"], bulletOrder: ["b3", "b2"] },
      { id: "keep-me", hidden: true, heading: "Edited" }
    );
    const r = reconcileImportedItem(edited, bankById);
    expect(r.diverged).toBe(true);
    expect("hiddenBulletIds" in r.item).toBe(false);
    expect("bulletOrder" in r.item).toBe(false);
    expect(r.item.id).toBe("keep-me");
    expect(r.item.hidden).toBe(true);
  });

  it("re-attaches the bullets this variant was hiding as hidden: true, with the bank's text", () => {
    const edited = inlined({ hiddenBulletIds: ["b2"] }, { heading: "Edited" });
    expect(ids(edited)).toEqual(["b1", "b3", "b4"]); // b2 is not in the file
    const r = reconcileImportedItem(edited, bankById);
    expect(r.diverged).toBe(true);
    expect(r.item.bullets.map((b) => [b.id, b.text, !!b.hidden])).toEqual([
      ["b1", "one", false],
      ["b3", "three", false],
      ["b4", "four", true],
      ["b2", "two", true], // re-attached, flagged
    ]);
  });

  it("the rendered (visible) bullets are exactly what the file showed", () => {
    const edited = inlined({ hiddenBulletIds: ["b1", "b2"] }, { heading: "Edited" });
    const r = reconcileImportedItem(edited, bankById);
    expect(visible(r.item)).toEqual(visible(edited));
  });

  it("placement: re-attached bullets follow the item's own bullets, in the BANK's order", () => {
    // hiddenBulletIds lists ids in reverse bank order, and the file's own bullets are reordered.
    const edited: Item = {
      ...inlined({ hiddenBulletIds: ["b3", "b1"] }, { heading: "Edited" }),
      bullets: [
        { id: "b4", text: "four", hidden: true },
        { id: "b2", text: "two" },
      ],
    };
    const r = reconcileImportedItem(edited, bankById);
    expect(ids(r.item)).toEqual(["b4", "b2", "b1", "b3"]);
    expect(r.item.bullets.slice(2).every((b) => b.hidden === true)).toBe(true);
  });

  it("a bullet the overlay hides but the file carries visible stays as the file has it (imported copy wins)", () => {
    const base = inlined({ hiddenBulletIds: ["b2"] }, { heading: "Edited" });
    const restored: Item = { ...base, bullets: [...base.bullets, { id: "b2", text: "two (restored)" }] };
    const r = reconcileImportedItem(restored, bankById);
    expect(ids(r.item).filter((id) => id === "b2")).toHaveLength(1); // not duplicated
    expect(r.item.bullets.find((b) => b.id === "b2")).toEqual({ id: "b2", text: "two (restored)" });
  });

  it("a hiddenBulletIds entry the bank no longer has is ignored", () => {
    const edited = inlined({ hiddenBulletIds: ["ghost", "b2"] }, { heading: "Edited" });
    const r = reconcileImportedItem(edited, bankById);
    expect(ids(r.item)).toEqual(["b1", "b3", "b4", "b2"]);
  });

  it("a bullet hidden by the overlay AND parked bank-wide comes back hidden", () => {
    const edited = inlined({ hiddenBulletIds: ["b4"] }, { heading: "Edited" });
    expect(ids(edited)).not.toContain("b4");
    const r = reconcileImportedItem(edited, bankById);
    expect(r.item.bullets.find((b) => b.id === "b4")?.hidden).toBe(true);
  });

  it("the result is detached, so resolving it again returns it untouched", () => {
    const r = reconcileImportedItem(inlined({ hiddenBulletIds: ["b2"] }, { heading: "Edited" }), bankById);
    expect(resolveItem(r.item, bankById)).toBe(r.item);
  });

  it("does not share bullet objects with the input or the bank entry", () => {
    const edited = inlined({ hiddenBulletIds: ["b2"] }, { heading: "Edited" });
    const r = reconcileImportedItem(edited, bankById);
    for (const b of r.item.bullets) {
      expect(edited.bullets.includes(b)).toBe(false);
      expect(entry.bullets.includes(b)).toBe(false);
    }
  });
});

describe("hazard 2: raw library items are not diverged", () => {
  it("a raw linked item stays linked and is returned unchanged", () => {
    const item = raw();
    const r = reconcileImportedItem(item, bankById);
    expect(r.item).toBe(item);
    expect(r.diverged).toBe(false);
    expect(r.item.link).toEqual({ bankId: "bank1" });
  });

  it("a raw linked item with an overlay keeps the overlay intact", () => {
    const item = raw({ hiddenBulletIds: ["b2"], bulletOrder: ["b3", "b1"], hidden: true });
    const r = reconcileImportedItem(item, bankById);
    expect(r.item).toBe(item);
    expect(r.diverged).toBe(false);
    expect(r.item.hiddenBulletIds).toEqual(["b2"]);
    expect(r.item.bulletOrder).toEqual(["b3", "b1"]);
  });

  it("`\"\"` and explicit undefined wording fields still count as no wording", () => {
    const item = raw({ heading: "", subheading: undefined, location: "", dateRange: "" });
    const r = reconcileImportedItem(item, bankById);
    expect(r.item).toBe(item);
    expect(r.diverged).toBe(false);
    expect(r.item.link?.detached).toBeUndefined();
  });

  it("is only about wording: ANY wording makes it an inlined item that gets compared", () => {
    // Bank has wording, so each of these differs from the resolved view and is diverged.
    const oneField = raw({ heading: "X" });
    const oneBullet = raw({ bullets: [{ id: "b1", text: "one" }] });
    const blankBullet = raw({ bullets: [{ id: "b1", text: "" }] });
    const whitespace = raw({ heading: " " });
    for (const item of [oneField, oneBullet, blankBullet, whitespace]) {
      const r = reconcileImportedItem(item, bankById);
      expect(r.diverged).toBe(true);
      expect(r.item.link).toEqual({ bankId: "bank1", detached: true });
    }
  });

  it("an inlined item whose bank entry resolves to empty: linked, no wording, not diverged", () => {
    const blankEntry: BankItem = { ...makeEntry(), heading: "", subheading: "", location: "", dateRange: "", bullets: [] };
    const allHidden: BankItem = {
      ...blankEntry,
      id: "bank2",
      bullets: [{ id: "x1", text: "only bullet" }],
    };
    const map = new Map([
      [blankEntry.id, blankEntry],
      [allHidden.id, allHidden],
    ]);

    // Entry with no wording at all, exported inlined (empty).
    const a = resolveItem(raw(), map);
    expect(a.bullets).toEqual([]);
    const ra = reconcileImportedItem(a, map);
    expect(ra.diverged).toBe(false);
    expect(ra.item.link).toEqual({ bankId: "bank1" });

    // Entry whose only bullet is hidden by this variant's overlay: resolves to empty.
    const b = resolveItem(raw({ link: { bankId: "bank2" }, hiddenBulletIds: ["x1"] }), map);
    expect(b.bullets).toEqual([]);
    const rb = reconcileImportedItem(b, map);
    expect(rb.diverged).toBe(false);
    expect(rb.item.link).toEqual({ bankId: "bank2" });
    expect(rb.item.hiddenBulletIds).toEqual(["x1"]); // overlay kept
  });

  it("an inlined item with content against an entry that resolves to empty IS diverged", () => {
    const blankEntry: BankItem = { ...makeEntry(), heading: "", subheading: "", location: "", dateRange: "", bullets: [] };
    const map = new Map([[blankEntry.id, blankEntry]]);
    const r = reconcileImportedItem(raw({ heading: "Added by Claude" }), map);
    expect(r.diverged).toBe(true);
    expect(r.item.heading).toBe("Added by Claude");
    expect(r.item.link).toEqual({ bankId: "bank1", detached: true });
  });

  it("documented residue: a fully blanked inlined item reads as raw and stays linked", () => {
    // Indistinguishable from a raw library item by the item alone.
    const blanked: Item = { ...inlined(), heading: "", subheading: "", location: "", dateRange: "", bullets: [], hidden: true };
    const r = reconcileImportedItem(blanked, bankById);
    expect(r.item).toBe(blanked);
    expect(r.diverged).toBe(false);
    expect(r.item.hidden).toBe(true); // item-level hidden is untouched
  });
});

describe("purity", () => {
  const cases: [string, Item, Map<string, BankItem>][] = [
    ["no link", { id: "l", heading: "h", bullets: [{ id: "x", text: "y" }] }, bankById],
    ["detached", inlined({}, { link: { bankId: "bank1", detached: true } }), bankById],
    ["entry missing", inlined({ hiddenBulletIds: ["b2"] }), emptyBank],
    ["raw linked", raw({ hiddenBulletIds: ["b2"], bulletOrder: ["b1"] }), bankById],
    ["identical", inlined({ hiddenBulletIds: ["b2"], bulletOrder: ["b3", "b1"] }), bankById],
    ["diverged", inlined({ hiddenBulletIds: ["b2"], bulletOrder: ["b3", "b1"] }, { heading: "Edited" }), bankById],
  ];

  it.each(cases)("%s: inputs are not mutated (frozen inputs do not throw)", (_, item, map) => {
    const itemBefore = structuredClone(item);
    const bankBefore = structuredClone([...map.values()]);
    deepFreeze(item);
    map.forEach(deepFreeze);
    expect(() => reconcileImportedItem(item, map)).not.toThrow();
    expect(item).toEqual(itemBefore);
    expect([...map.values()]).toEqual(bankBefore);
  });
});

describe("the outcome is a valid Item", () => {
  const cases: [string, Item, Map<string, BankItem>][] = [
    ["no link", { id: "l", bullets: [] }, bankById],
    ["detached", inlined({}, { link: { bankId: "bank1", detached: true } }), bankById],
    ["entry missing", inlined({ hiddenBulletIds: ["b2"] }), emptyBank],
    ["raw linked", raw({ hiddenBulletIds: ["b2"] }), bankById],
    ["identical", inlined({ hiddenBulletIds: ["b2"] }), bankById],
    ["diverged", inlined({ hiddenBulletIds: ["b2"] }, { heading: "Edited" }), bankById],
  ];

  it.each(cases)("%s: parses under ItemSchema and nothing is stripped", (_, item, map) => {
    const { item: out } = reconcileImportedItem(item, map);
    const parsed = ItemSchema.safeParse(out);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(out);
  });
});

describe("bakeOverlayKeepingContent shares the baking rules with bakeOverlay", () => {
  const overlays: [string, Overlay][] = [
    ["no overlay", {}],
    ["hidden only", { hiddenBulletIds: ["b2"] }],
    ["order only", { bulletOrder: ["b3", "b1"] }],
    ["both", { hiddenBulletIds: ["b1", "b4"], bulletOrder: ["b3", "b2"] }],
  ];

  it.each(overlays)(
    "%s: baking the unedited inlined view matches baking the raw item (visible bullets, hidden set, wording, link)",
    (_, overlay) => {
      const rawItem = raw(overlay);
      const viaBank = bakeOverlay(rawItem, entry);
      const viaOwn = bakeOverlayKeepingContent(resolveItem(rawItem, bankById), entry);

      expect(visible(viaOwn)).toEqual(visible(viaBank));
      const hiddenSet = (i: Item) => i.bullets.filter((b) => b.hidden).map((b) => b.id).sort();
      expect(hiddenSet(viaOwn)).toEqual(hiddenSet(viaBank));
      for (const k of WORDING_KEYS) expect(viaOwn[k]).toBe(viaBank[k]);
      expect(viaOwn.link).toEqual(viaBank.link);
      expect("hiddenBulletIds" in viaOwn).toBe(false);
      expect("bulletOrder" in viaOwn).toBe(false);
    }
  );

  it("keeps the item's own wording where bakeOverlay would overwrite it from the bank", () => {
    const edited = inlined({ hiddenBulletIds: ["b2"] }, { heading: "Edited" });
    expect(bakeOverlay(edited, entry).heading).toBe("Bank Co");
    expect(bakeOverlayKeepingContent(edited, entry).heading).toBe("Edited");
  });

  it("does not add wording keys the item did not have", () => {
    const item: Item = { id: "i1", bullets: [{ id: "z", text: "z" }], link: { bankId: "bank1" } };
    const out = bakeOverlayKeepingContent(item, entry);
    for (const k of WORDING_KEYS) expect(k in out).toBe(false);
  });
});
