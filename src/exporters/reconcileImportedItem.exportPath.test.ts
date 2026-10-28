import { describe, expect, it } from "vitest";
import { reconcileImportedItem } from "../store/reconcile";
import { resolveItem } from "../store/resolve";
import { CURRENT_SCHEMA_VERSION } from "../store/schema";
import type { BankItem, Item, Resume } from "../store/schema";
import { libraryJsonPayload, parseImport, resumeJsonPayload } from "./importExport";

/**
 * Task 9.4, through the real serializers and the real `parseImport` (zod): what
 * `reconcileImportedItem` does with items exactly as they arrive from a file.
 * `parseImport` is given a pass-through reconciler here (`rawParse`), so the
 * items stay exactly as zod parsed them and the tests run the item reconciler
 * over them themselves. The real wiring is covered in importDivergence.test.ts.
 *
 * - single-variant export = INLINED linked items (resolved view + metadata);
 * - library export        = RAW linked items (no wording, `bullets: []`).
 *
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**
 */

const entry: BankItem = {
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
};
const other: BankItem = {
  id: "bank2",
  kind: "projects",
  heading: "Side Project",
  bullets: [{ id: "p1", text: "built it" }],
  updatedAt: "2024-01-01T00:00:00.000Z",
};
const bank = [entry, other];
const bankById = new Map(bank.map((b) => [b.id, b]));

/** The RAW items of the variant under test, as the store holds them. */
const rawItems = (): Item[] => [
  // overlay only: this is the "no-op" case
  { id: "i_overlay", bullets: [], link: { bankId: "bank1" }, hiddenBulletIds: ["b2"], bulletOrder: ["b3", "b1"] },
  // no overlay at all
  { id: "i_plain", bullets: [], link: { bankId: "bank2" } },
  // item-level hidden plus both overlay keys
  { id: "i_hidden", bullets: [], hidden: true, link: { bankId: "bank1" }, hiddenBulletIds: ["b1"], bulletOrder: ["b2"] },
  // a detached local copy and a purely local item
  {
    id: "i_detached",
    heading: "My own wording",
    bullets: [{ id: "d1", text: "mine" }],
    link: { bankId: "bank1", detached: true },
  },
  { id: "i_local", heading: "Local", bullets: [{ id: "l1", text: "local" }] },
];

const makeVariant = (items: Item[] = rawItems()): Resume => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "r1",
  name: "V",
  updatedAt: "2024-01-01T00:00:00.000Z",
  header: { fullName: "N", fields: [] },
  sections: [{ id: "s1", kind: "experience", title: "Experience", items }],
});

/** What 9.5 will do per variant, minimally: reconcile every item and sum the flags. */
function reconcileAll(variant: Resume, map: Map<string, BankItem>) {
  let count = 0;
  const items = variant.sections.flatMap((s) =>
    s.items.map((i) => {
      const r = reconcileImportedItem(i, map);
      if (r.diverged) count += 1;
      return r.item;
    })
  );
  return { items, count };
}

/** Parse with reconciliation switched off: items are returned as zod parsed them. */
const rawParse = { reconcileVariant: (variant: Resume) => ({ variant, diverged: 0 }) };

/** A single-variant file as `parseImport` hands it back (zod-parsed), against the store's bank. */
function importSingle(variant: Resume, fileEdit?: (v: Resume) => void): Resume {
  const json = JSON.parse(resumeJsonPayload(variant, bank)) as Resume;
  fileEdit?.(json);
  const parsed = parseImport(JSON.stringify(json), { getCurrentBank: () => bank, ...rawParse });
  if (parsed.kind !== "resume") throw new Error(`expected resume, got ${parsed.kind}`);
  return parsed.resume;
}

describe("single-variant export, nothing edited: the overlay is a no-op", () => {
  it("every linked item comes back identical to the raw one, still linked, count zero", () => {
    const variant = makeVariant();
    const imported = importSingle(variant);

    // Precondition: the file really carries inlined wording for the linked items.
    const overlayItem = imported.sections[0].items[0];
    expect(overlayItem.heading).toBe("Bank Co");
    expect(overlayItem.bullets.map((b) => b.id)).toEqual(["b3", "b1", "b4"]);

    const { items, count } = reconcileAll(imported, bankById);
    expect(count).toBe(0);
    expect(items).toEqual(rawItems());
  });

  it("the overlay item specifically: stays linked with hiddenBulletIds and bulletOrder, no wording", () => {
    const [item] = importSingle(makeVariant()).sections[0].items;
    const r = reconcileImportedItem(item, bankById);
    expect(r.diverged).toBe(false);
    expect(r.item.link).toEqual({ bankId: "bank1" });
    expect(r.item.hiddenBulletIds).toEqual(["b2"]);
    expect(r.item.bulletOrder).toEqual(["b3", "b1"]);
    expect(r.item.bullets).toStrictEqual([]);
    expect(r.item.heading).toBeUndefined();
    // And it resolves to the same thing the exported file showed.
    expect(resolveItem(r.item, bankById).bullets.map((b) => b.id)).toEqual(["b3", "b1", "b4"]);
  });

  it("the same file imported against an empty bank orphans the links and keeps the inlined wording", () => {
    const imported = importSingle(makeVariant());
    const { items, count } = reconcileAll(imported, new Map());
    expect(count).toBe(0);
    const overlayItem = items[0];
    expect(overlayItem.link).toBeUndefined();
    expect(overlayItem.hiddenBulletIds).toBeUndefined();
    expect(overlayItem.bulletOrder).toBeUndefined();
    expect(overlayItem.heading).toBe("Bank Co");
    expect(overlayItem.bullets.map((b) => b.id)).toEqual(["b3", "b1", "b4"]);
  });
});

describe("single-variant export, one linked item really edited", () => {
  const edit = (v: Resume) => {
    const item = v.sections[0].items[0]; // i_overlay: hides b2, order b3 b1 (b4 parked)
    item.heading = "Bank Co, Staff Engineer";
    item.bullets = item.bullets.map((b) => (b.id === "b1" ? { ...b, text: "one (reworded)" } : b));
  };

  it("the edited item is detached with its edited wording intact; siblings are untouched; count is one", () => {
    const imported = importSingle(makeVariant(), edit);
    const { items, count } = reconcileAll(imported, bankById);
    expect(count).toBe(1);

    const [edited, ...rest] = items;
    expect(edited.link).toEqual({ bankId: "bank1", detached: true });
    expect(edited.heading).toBe("Bank Co, Staff Engineer");
    expect(edited.subheading).toBe("Engineer");
    expect(edited.bullets.find((b) => b.id === "b1")?.text).toBe("one (reworded)");
    expect("hiddenBulletIds" in edited).toBe(false);
    expect("bulletOrder" in edited).toBe(false);

    // The other items are exactly the raw ones.
    expect(rest).toEqual(rawItems().slice(1));
  });

  it("the bullet the overlay hid is re-attached as hidden: true, and the rendered bullets are the edited file's", () => {
    const imported = importSingle(makeVariant(), edit);
    const fileItem = imported.sections[0].items[0];
    expect(fileItem.bullets.map((b) => b.id)).not.toContain("b2"); // hidden by the overlay in the file

    const { item } = reconcileImportedItem(fileItem, bankById);

    const b2 = item.bullets.find((b) => b.id === "b2");
    expect(b2).toEqual({ id: "b2", text: "two", hidden: true });
    // Everything the file showed is still shown, in the file's order; b2 is the only addition and is hidden.
    expect(item.bullets.filter((b) => !b.hidden)).toEqual(fileItem.bullets.filter((b) => !b.hidden));
    expect(item.bullets.slice(0, fileItem.bullets.length)).toEqual(fileItem.bullets);
    expect(item.bullets).toHaveLength(fileItem.bullets.length + 1);

    // Detached now, so the resolver returns it as-is: the edited wording is what renders.
    expect(resolveItem(item, bankById)).toBe(item);
  });

  it("an edit the bank cannot explain is kept even when only a bullet was added", () => {
    const imported = importSingle(makeVariant(), (v) => {
      v.sections[0].items[1].bullets.push({ id: "p2", text: "added by Claude" });
    });
    const { items, count } = reconcileAll(imported, bankById);
    expect(count).toBe(1);
    expect(items[1].link).toEqual({ bankId: "bank2", detached: true });
    expect(items[1].bullets.map((b) => b.id)).toEqual(["p1", "p2"]);
  });

  it("the file's detached and local items are never counted, whatever they say", () => {
    const imported = importSingle(makeVariant(), (v) => {
      v.sections[0].items[3].heading = "Bank Co"; // detached item now equals the bank's heading
    });
    const { items, count } = reconcileAll(imported, bankById);
    expect(count).toBe(0);
    expect(items[3].heading).toBe("Bank Co");
    expect(items[3].bullets).toEqual([{ id: "d1", text: "mine" }]); // not wiped
  });
});

describe("library export: raw linked items are not diverged", () => {
  const importLibrary = (variants: Resume[], b: BankItem[] = bank) => {
    const parsed = parseImport(libraryJsonPayload(variants, b), rawParse);
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);
    return parsed;
  };

  it("against the imported bank, every raw item is returned as it was: linked, overlay intact, count zero", () => {
    const parsed = importLibrary([makeVariant()]);
    // Precondition: raw linked items carry no wording in the file.
    const fileItem = parsed.variants[0].sections[0].items[0];
    expect(fileItem.bullets).toEqual([]);
    expect(fileItem.heading).toBeUndefined();

    const { items, count } = reconcileAll(parsed.variants[0], new Map(parsed.bank.map((b) => [b.id, b])));
    expect(count).toBe(0);
    expect(items).toEqual(rawItems());
    for (const item of items.filter((i) => i.link && !i.link.detached)) {
      expect(item.link?.detached).toBeUndefined();
    }
  });

  it("a library file with no bank: raw links dangle, are dropped, and nothing is invented", () => {
    const json = JSON.parse(libraryJsonPayload([makeVariant()], bank)) as Record<string, unknown>;
    delete json.bank;
    const parsed = parseImport(JSON.stringify(json), rawParse);
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);
    expect(parsed.bank).toEqual([]);

    const { items, count } = reconcileAll(parsed.variants[0], new Map());
    expect(count).toBe(0);
    expect(items[0]).toStrictEqual({ id: "i_overlay", bullets: [] });
    expect(items[1]).toStrictEqual({ id: "i_plain", bullets: [] });
    expect(items[2]).toStrictEqual({ id: "i_hidden", hidden: true, bullets: [] });
    // Items that carry their own wording are kept: the detached copy keeps its link (branch 2).
    expect(items[3]).toEqual(rawItems()[3]);
    expect(items[4]).toEqual(rawItems()[4]);
  });
});

describe("no link metadata anywhere (v2 and plain files)", () => {
  it("every item passes through as the same object, count zero", () => {
    const local: Item[] = [
      { id: "a", heading: "A", bullets: [{ id: "a1", text: "x" }] },
      { id: "b", bullets: [] },
    ];
    const imported = importSingle(makeVariant(local));
    const { items, count } = reconcileAll(imported, bankById);
    expect(count).toBe(0);
    expect(items).toEqual(local);
    imported.sections[0].items.forEach((item, i) => {
      expect(reconcileImportedItem(item, bankById).item).toBe(imported.sections[0].items[i]);
    });
  });
});
