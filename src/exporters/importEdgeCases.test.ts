import { describe, expect, it } from "vitest";
import { migratePersistedLibrary } from "../store/migrations";
import type { BankItem } from "../store/schema";
import { parseImport } from "./importExport";

/**
 * Example-based edge cases for the v1/v2/v3 upgrade paths (task 5.10).
 * Property 1 (migrations.test.ts) covers valid v2 libraries generically; these
 * pin the older-version chains, missing-`bank` handling and error paths.
 */

const sections = [
  {
    id: "s1",
    kind: "experience",
    title: "Experience",
    items: [
      {
        id: "i1",
        heading: "Acme",
        subheading: "Engineer",
        bullets: [{ id: "b1", text: "Shipped **things**" }],
      },
    ],
  },
];

/** A v1 resume: flat header with location/phone/email/links. */
function v1Resume(id: string, name = "Base") {
  return {
    schemaVersion: 1,
    id,
    name,
    updatedAt: "2024-01-01T00:00:00.000Z",
    header: {
      fullName: "Ada Lovelace",
      location: "London",
      phone: "555-0100",
      email: "ada@example.com",
      links: [{ label: "GitHub", url: "https://github.com/ada" }],
    },
    sections,
  };
}

/** A v2 resume: `header.fields`, no bank-related keys. */
function v2Resume(id: string) {
  return {
    schemaVersion: 2,
    id,
    name: `Variant ${id}`,
    updatedAt: "2024-02-01T00:00:00.000Z",
    header: { fullName: "Ada", fields: [{ id: "hf1", label: "London" }] },
    sections,
  };
}

const bankItem: BankItem = {
  id: "bk_1",
  kind: "experience",
  label: "Acme SWE",
  heading: "Acme",
  bullets: [{ id: "b_1", text: "Did a thing" }],
  updatedAt: "2025-01-01T00:00:00.000Z",
};

describe("v1 imports chain through to v3", () => {
  it("a v1 single resume imports as kind 'resume' at v3 with header.fields built from the flat header", () => {
    const parsed = parseImport(JSON.stringify(v1Resume("r1")));
    if (parsed.kind !== "resume") throw new Error(`expected resume, got ${parsed.kind}`);
    const { resume } = parsed;

    expect(resume.schemaVersion).toBe(3);
    expect(resume.id).toBe("r1");
    expect(resume.header.fullName).toBe("Ada Lovelace");

    const fields = resume.header.fields;
    expect(fields.map((f) => f.label)).toEqual([
      "London",
      "555-0100",
      "ada@example.com",
      "GitHub",
    ]);
    expect(fields.map((f) => f.url)).toEqual([
      undefined,
      undefined,
      "mailto:ada@example.com",
      "https://github.com/ada",
    ]);
    for (const f of fields) expect(f.id).toEqual(expect.any(String));
    expect(new Set(fields.map((f) => f.id)).size).toBe(fields.length);
    // Flat v1 keys are gone.
    expect(resume.header).not.toHaveProperty("email");
    expect(resume.header).not.toHaveProperty("links");

    expect(resume.sections).toEqual(sections);
  });

  it("a v1 library chains v1 -> v2 -> v3: kind 'library', every variant at v3, bank []", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      variants: [v1Resume("r1", "One"), v1Resume("r2", "Two")],
    });
    const parsed = parseImport(raw);
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);

    expect(parsed.bank).toEqual([]);
    expect(parsed.variants.map((v) => v.id)).toEqual(["r1", "r2"]);
    expect(parsed.variants.map((v) => v.name)).toEqual(["One", "Two"]);
    for (const v of parsed.variants) {
      expect(v.schemaVersion).toBe(3);
      expect(v.header.fields).toHaveLength(4);
      expect(v.header.fields[2]).toMatchObject({
        label: "ada@example.com",
        url: "mailto:ada@example.com",
      });
      expect(v.sections).toEqual(sections);
    }
  });
});

describe("missing `bank` key defaults to an empty bank", () => {
  it("a v2 library with no bank key imports as a library with bank [], variants unchanged but for version", () => {
    const variants = [v2Resume("a"), v2Resume("b")];
    const parsed = parseImport(JSON.stringify({ schemaVersion: 2, variants }));
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);

    expect(parsed.bank).toEqual([]);
    expect(parsed.variants).toEqual(variants.map((v) => ({ ...v, schemaVersion: 3 })));
  });

  it("a v3 library with the bank key absent gets bank []; an explicit empty bank also works", () => {
    const variants = [{ ...v2Resume("a"), schemaVersion: 3 }];

    const absent = parseImport(JSON.stringify({ schemaVersion: 3, variants }));
    if (absent.kind !== "library") throw new Error(`expected library, got ${absent.kind}`);
    expect(absent.bank).toEqual([]);
    expect(absent.variants).toEqual(variants);

    const explicit = parseImport(JSON.stringify({ schemaVersion: 3, variants, bank: [] }));
    if (explicit.kind !== "library") throw new Error(`expected library, got ${explicit.kind}`);
    expect(explicit.bank).toEqual([]);
    expect(explicit.variants).toEqual(variants);
  });

  it("a v3 library that has a bank keeps it verbatim", () => {
    const variants = [{ ...v2Resume("a"), schemaVersion: 3 }];
    const parsed = parseImport(JSON.stringify({ schemaVersion: 3, variants, bank: [bankItem] }));
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);
    expect(parsed.bank).toEqual([bankItem]);
  });
});

describe("migratePersistedLibrary edge cases", () => {
  it("from version 1 (flat header) chains through to v3 with bank []", () => {
    const persisted = { variants: [v1Resume("r1")], currentVariantId: "r1" };
    const migrated = migratePersistedLibrary(persisted, 1);

    expect(migrated.bank).toEqual([]);
    expect(migrated.currentVariantId).toBe("r1");
    expect(migrated.variants).toHaveLength(1);
    const [v] = migrated.variants;
    expect(v.schemaVersion).toBe(3);
    expect(v.header.fields.map((f) => f.label)).toEqual([
      "London",
      "555-0100",
      "ada@example.com",
      "GitHub",
    ]);
    expect(v.header.fields[2].url).toBe("mailto:ada@example.com");
    expect(v.sections).toEqual(sections);
  });

  it("from version 2 with no bank key gives bank [] and bumps variants to v3", () => {
    const persisted = { variants: [v2Resume("a")], currentVariantId: "a" };
    const migrated = migratePersistedLibrary(persisted, 2);
    expect(migrated.bank).toEqual([]);
    expect(migrated.variants).toEqual([{ ...v2Resume("a"), schemaVersion: 3 }]);
  });

  it("from version 3 with no bank key gives bank [] and leaves variants alone", () => {
    const variants = [{ ...v2Resume("a"), schemaVersion: 3 }];
    const migrated = migratePersistedLibrary({ variants, currentVariantId: "a" }, 3);
    expect(migrated.bank).toEqual([]);
    expect(migrated.variants).toEqual(variants);
  });

  it("a state that already has a bank keeps it verbatim", () => {
    const variants = [{ ...v2Resume("a"), schemaVersion: 3 }];
    const migrated = migratePersistedLibrary(
      { variants, currentVariantId: "a", bank: [bankItem] },
      3
    );
    expect(migrated.bank).toEqual([bankItem]);
  });
});

describe("invalid input still returns kind 'error' without throwing", () => {
  it.each([
    ["garbage text", "not json at all {{{"],
    ["empty string", ""],
    ["truncated JSON", '{"schemaVersion": 3, "variants": ['],
  ])("%s", (_name, raw) => {
    const parsed = parseImport(raw);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") expect(parsed.messages[0]).toMatch(/Invalid JSON/);
  });

  it.each([
    ["JSON null", "null"],
    ["a bare number", "42"],
    ["an empty object", "{}"],
    ["a library whose variants is not an array", JSON.stringify({ schemaVersion: 3, variants: "nope" })],
    ["a library with an invalid variant", JSON.stringify({ schemaVersion: 3, variants: [{ id: "x" }] })],
    ["a v2 library with an invalid variant", JSON.stringify({ schemaVersion: 2, variants: [{ id: "x" }] })],
    ["a library with a malformed bank", JSON.stringify({ schemaVersion: 3, variants: [], bank: [{ id: "bk" }] })],
    ["an unknown future schemaVersion", JSON.stringify({ ...v2Resume("a"), schemaVersion: 99 })],
  ])("%s", (_name, raw) => {
    const parsed = parseImport(raw);
    expect(parsed.kind).toBe("error");
    if (parsed.kind === "error") expect(parsed.messages[0]).toBe("Not a valid Resume or Library file.");
  });
});

/**
 * Task 9.6: the post-migration path is a plain reconciliation pass-through.
 *
 * A migrated file (v1 -> v2 -> v3, or v2 -> v3) produces items with no `link`
 * and the bank defaults to `[]`, so every item hits `reconcileImportedItem`'s
 * first branch (no link -> returned unchanged, not diverged). `parseImport`
 * must therefore report `diverged: 0` and leave every item deep-equal to the
 * migrated input. These assertions run the REAL `migrateImport` chain and the
 * REAL reconciler end to end — the complement to the per-item/no-link cases
 * already pinned in reconcileImportedItem.test.ts (branch 1) and
 * reconcileImportedItem.exportPath.test.ts ("no link metadata anywhere").
 *
 * **Validates: Requirements 10.5**
 */
describe("migrated files reconcile as pass-throughs (diverged 0, items unchanged)", () => {
  it("a v2 library import: diverged 0, every item deep-equal to the migrated input", () => {
    const variants = [v2Resume("a"), v2Resume("b")];
    const parsed = parseImport(JSON.stringify({ schemaVersion: 2, variants }));
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);

    expect(parsed.diverged).toBe(0);
    expect(parsed.bank).toEqual([]);
    // Migration bumps the version and nothing else; the sections (and so every
    // item) survive byte-for-byte through reconciliation.
    expect(parsed.variants).toEqual(variants.map((v) => ({ ...v, schemaVersion: 3 })));
    for (const v of parsed.variants) {
      expect(v.sections).toEqual(sections);
      for (const item of v.sections.flatMap((s) => s.items)) {
        expect(item).not.toHaveProperty("link");
      }
    }
  });

  it("a v1 library chaining v1 -> v2 -> v3: diverged 0, items carry no link", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      variants: [v1Resume("r1", "One"), v1Resume("r2", "Two")],
    });
    const parsed = parseImport(raw);
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);

    expect(parsed.diverged).toBe(0);
    expect(parsed.bank).toEqual([]);
    for (const v of parsed.variants) {
      expect(v.sections).toEqual(sections);
      for (const item of v.sections.flatMap((s) => s.items)) {
        expect(item).not.toHaveProperty("link");
      }
    }
  });

  it("a v2 single resume import: diverged 0, sections unchanged", () => {
    const parsed = parseImport(JSON.stringify(v2Resume("solo")));
    if (parsed.kind !== "resume") throw new Error(`expected resume, got ${parsed.kind}`);

    expect(parsed.diverged).toBe(0);
    expect(parsed.resume.schemaVersion).toBe(3);
    expect(parsed.resume.sections).toEqual(sections);
  });

  it("a v1 single resume chaining to v3: diverged 0, sections unchanged", () => {
    const parsed = parseImport(JSON.stringify(v1Resume("r1")));
    if (parsed.kind !== "resume") throw new Error(`expected resume, got ${parsed.kind}`);

    expect(parsed.diverged).toBe(0);
    expect(parsed.resume.sections).toEqual(sections);
  });

  it("the imported bank stays empty: a migrated file never consults a store bank", () => {
    const parsed = parseImport(JSON.stringify({ schemaVersion: 2, variants: [v2Resume("a")] }), {
      // Even a hostile store bank is irrelevant: a library import reconciles
      // against the file's own (empty) bank, and no item is linked anyway.
      getCurrentBank: () => [bankItem],
    });
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);
    expect(parsed.diverged).toBe(0);
    expect(parsed.bank).toEqual([]);
  });
});
