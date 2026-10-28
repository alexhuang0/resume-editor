import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseImport } from "../exporters/importExport";
import { migratePersistedLibrary } from "./migrations";
import { LibrarySchema, ResumeSchema } from "./schema";
import type { Resume } from "./schema";

/**
 * Feature: item-bank-and-editor-ux, Property 1: Migration preserves every
 * variant and adds an empty bank
 *
 * For any valid v2 library document, migrating to v3 produces a document whose
 * `variants` are deep-equal to the input's, whose `bank` is empty, whose
 * `schemaVersion` is 3, and which parses successfully against the v3
 * `LibrarySchema` -- and `parseImport` and the zustand `migrate` produce the
 * same result for the same input.
 *
 * **Validates: Requirements 5.6, 5.5**
 */

const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// Generators: valid v2 documents. No `link` / `hiddenBulletIds` / `bulletOrder`
// on items, no `bank` key anywhere -- those are v3 additions.
// ---------------------------------------------------------------------------

/** Required key always present; optional keys are either omitted or set (JSON drops `undefined`). */
const text = fc.string({ maxLength: 20 });
const id = fc.string({ minLength: 1, maxLength: 12 });
const flag = fc.boolean();

const bullet = fc.record(
  { id, text, hidden: flag },
  { requiredKeys: ["id", "text"] }
);

const item = fc.record(
  {
    id,
    heading: text,
    subheading: text,
    location: text,
    dateRange: text,
    hidden: flag,
    bullets: fc.array(bullet, { maxLength: 4 }),
  },
  { requiredKeys: ["id", "bullets"] }
);

const section = fc.record(
  {
    id,
    kind: fc.constantFrom("education", "experience", "projects", "skills", "custom"),
    title: text,
    hidden: flag,
    items: fc.array(item, { maxLength: 3 }),
  },
  { requiredKeys: ["id", "kind", "title", "items"] }
);

const headerField = fc.record(
  { id, label: text, url: text, hidden: flag },
  { requiredKeys: ["id", "label"] }
);

/** A v2 resume as it would sit in a v2 JSON file or v2 localStorage state. */
const v2Resume = fc.record(
  {
    schemaVersion: fc.constant(2 as const),
    // Non-empty: parseImport deliberately replaces an empty id, which is not a migration concern.
    id,
    name: text,
    updatedAt: text,
    font: fc.constantFrom("latin-modern", "system-serif"),
    header: fc.record({ fullName: text, fields: fc.array(headerField, { maxLength: 4 }) }),
    sections: fc.array(section, { maxLength: 3 }),
  },
  { requiredKeys: ["schemaVersion", "id", "name", "updatedAt", "header", "sections"] }
);

const v2Library = fc.record({
  schemaVersion: fc.constant(2 as const),
  variants: fc.uniqueArray(v2Resume, { minLength: 1, maxLength: 4, selector: (r) => r.id }),
});

type V2Resume = typeof v2Resume extends fc.Arbitrary<infer T> ? T : never;
type AnyResume = { [k: string]: unknown };

/** The expected v3 form of a v2 resume: identical except for the version stamp. */
function asV3(r: V2Resume): AnyResume {
  return { ...r, schemaVersion: 3 };
}

/** Every id in document order, so (c) can assert nothing was added, dropped or rewritten. */
function collectIds(variants: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const v of variants as Resume[]) {
    out.push(v.id);
    for (const f of v.header.fields) out.push(f.id);
    for (const s of v.sections) {
      out.push(s.id);
      for (const it of s.items) {
        out.push(it.id);
        for (const b of it.bullets) out.push(b.id);
      }
    }
  }
  return out;
}

describe("Feature: item-bank-and-editor-ux, Property 1: migration preserves every variant and adds an empty bank", () => {
  it("(a) parseImport of a v2 library keeps every variant, bumps to v3 and yields an empty bank", () => {
    fc.assert(
      fc.property(v2Library, (lib) => {
        const parsed = parseImport(JSON.stringify(lib));
        expect(parsed.kind).toBe("library");
        if (parsed.kind !== "library") return;
        expect(parsed.variants).toEqual(lib.variants.map(asV3));
        expect(parsed.bank).toEqual([]);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("(b) the persisted-state migrate from v2 gives the same variants as parseImport, with an empty bank", () => {
    fc.assert(
      fc.property(v2Library, fc.nat(), (lib, pick) => {
        const currentVariantId = lib.variants[pick % lib.variants.length].id;
        // JSON round-trip: localStorage hands migrate parsed JSON, not live objects.
        const persisted = JSON.parse(
          JSON.stringify({ variants: lib.variants, currentVariantId })
        );
        const migrated = migratePersistedLibrary(persisted, 2);

        expect(migrated.variants).toEqual(lib.variants.map(asV3));
        expect(migrated.bank).toEqual([]);
        expect(migrated.currentVariantId).toBe(currentVariantId);

        // The migrated state is a valid v3 library.
        const check = LibrarySchema.safeParse({
          schemaVersion: 3,
          variants: migrated.variants,
          bank: migrated.bank,
        });
        expect(check.success).toBe(true);

        // Both upgrade paths agree.
        const parsed = parseImport(JSON.stringify(lib));
        expect(parsed.kind).toBe("library");
        if (parsed.kind !== "library") return;
        expect(migrated.variants).toEqual(parsed.variants);
        expect(migrated.bank).toEqual(parsed.bank);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("(c) every variant, header field, section, item and bullet id is preserved in order", () => {
    fc.assert(
      fc.property(v2Library, (lib) => {
        const expected = collectIds(lib.variants);
        const parsed = parseImport(JSON.stringify(lib));
        expect(parsed.kind).toBe("library");
        if (parsed.kind !== "library") return;
        const migrated = migratePersistedLibrary(
          JSON.parse(JSON.stringify({ variants: lib.variants, currentVariantId: "x" })),
          2
        );

        expect(parsed.variants).toHaveLength(lib.variants.length);
        expect(collectIds(parsed.variants)).toEqual(expected);
        expect(collectIds(migrated.variants)).toEqual(expected);
        // Nothing rewritten: no item gained a link or bank-only field.
        for (const v of parsed.variants)
          for (const s of v.sections)
            for (const it of s.items) {
              expect(it.link).toBeUndefined();
              expect(it.hiddenBulletIds).toBeUndefined();
              expect(it.bulletOrder).toBeUndefined();
            }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("a v2 single-resume import comes back as kind 'resume' at version 3, otherwise unchanged", () => {
    fc.assert(
      fc.property(v2Resume, (r) => {
        const parsed = parseImport(JSON.stringify(r));
        expect(parsed.kind).toBe("resume");
        if (parsed.kind !== "resume") return;
        expect(parsed.resume.schemaVersion).toBe(3);
        expect(parsed.resume).toEqual(asV3(r));
        expect(ResumeSchema.safeParse(parsed.resume).success).toBe(true);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
