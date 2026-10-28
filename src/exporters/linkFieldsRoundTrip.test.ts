import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { libraryJsonPayload, parseImport, resumeJsonPayload } from "./importExport";
import { ResumeSchema } from "../store/schema";
import type { Item, Resume } from "../store/schema";

/**
 * Feature: item-bank-and-editor-ux, Property 8: Link-carrying fields survive a
 * serialization round trip
 *
 * For any item carrying `link`, `hiddenBulletIds`, or `bulletOrder`, parsing
 * its serialized form returns those fields intact rather than stripped. This
 * holds on the single-resume export path, the library export path, and a bare
 * `ResumeSchema` parse of JSON-round-tripped data -- including ids that name
 * bullets not present in the item's own bullets, and empty arrays.
 *
 * **Validates: Requirements 5.7, 10.1**
 */

const NUM_RUNS = 200;

const text = fc.string({ maxLength: 20 });
const id = fc.string({ minLength: 1, maxLength: 12 });
const flag = fc.boolean();

const bullet = fc.record({ id, text, hidden: flag }, { requiredKeys: ["id", "text"] });

/** `detached` is optional: absent, true or false. */
const link = fc.record({ bankId: id, detached: flag }, { requiredKeys: ["bankId"] });

/**
 * Id lists are drawn independently of the item's bullets, so they routinely name
 * bullets that do not exist on the item (orphans). Empty arrays are in range.
 */
const idList = fc.array(id, { maxLength: 6 });

const item = fc.record(
  {
    id,
    heading: text,
    subheading: text,
    location: text,
    dateRange: text,
    hidden: flag,
    bullets: fc.array(bullet, { maxLength: 4 }),
    link,
    hiddenBulletIds: idList,
    bulletOrder: idList,
  },
  { requiredKeys: ["id", "bullets"] }
);

/** An item that carries at least one of the three link fields. */
const linkCarryingItem = item.filter(
  (it) => it.link !== undefined || it.hiddenBulletIds !== undefined || it.bulletOrder !== undefined
);

const section = fc.record({
  id,
  kind: fc.constantFrom("education", "experience", "projects", "skills", "custom"),
  title: text,
  items: fc.array(linkCarryingItem, { minLength: 1, maxLength: 3 }),
});

const headerField = fc.record({ id, label: text }, { requiredKeys: ["id", "label"] });

/** A valid v3 resume whose items carry link / hiddenBulletIds / bulletOrder. */
const v3Resume = fc.record({
  schemaVersion: fc.constant(3 as const),
  id,
  name: text,
  updatedAt: text,
  header: fc.record({ fullName: text, fields: fc.array(headerField, { maxLength: 3 }) }),
  sections: fc.array(section, { minLength: 1, maxLength: 3 }),
})
  // fc.record can emit null-prototype objects, which `toStrictEqual` treats as a different
  // type from the plain objects zod returns. Clone into plain objects so the strict
  // comparison only flags real differences (stripped fields, stray `undefined` keys).
  .map((r) => JSON.parse(JSON.stringify(r)) as Resume);

const itemsOf = (r: Resume): Item[] => r.sections.flatMap((s) => s.items);

/**
 * Property 8 is about the SERIALIZATION layer: `link`, `hiddenBulletIds` and
 * `bulletOrder` must survive the JSON write/read, not be stripped by zod. Task
 * 9.5 wired the real import-side reconciler into `parseImport`, which legitimately
 * rewrites those same fields (an orphaned link against an empty bank is dropped,
 * a diverged item is detached). That is a different contract, covered by the 9.x
 * reconciliation tests. To keep Property 8 pinned to serialization alone, parse
 * with reconciliation switched off via the injectable seam, exactly as
 * reconcileImportedItem.exportPath.test.ts does.
 */
const rawParse = { reconcileVariant: (variant: Resume) => ({ variant, diverged: 0 }) };

describe("Feature: item-bank-and-editor-ux, Property 8: link-carrying fields survive a serialization round trip", () => {
  it("survives the single-resume export -> parseImport path", () => {
    fc.assert(
      fc.property(v3Resume, (resume) => {
        const parsed = parseImport(resumeJsonPayload(resume), rawParse);
        expect(parsed.kind).toBe("resume");
        if (parsed.kind !== "resume") return;
        expect(itemsOf(parsed.resume)).toStrictEqual(itemsOf(resume));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("survives the library export -> parseImport path", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(v3Resume, { minLength: 1, maxLength: 3, selector: (r) => r.id }),
        (variants) => {
          const parsed = parseImport(libraryJsonPayload(variants, []), rawParse);
          expect(parsed.kind).toBe("library");
          if (parsed.kind !== "library") return;
          expect(parsed.variants.flatMap(itemsOf)).toStrictEqual(variants.flatMap(itemsOf));
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("survives a bare ResumeSchema parse of JSON-round-tripped data", () => {
    fc.assert(
      fc.property(v3Resume, (resume) => {
        const result = ResumeSchema.safeParse(JSON.parse(JSON.stringify(resume)));
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(itemsOf(result.data)).toStrictEqual(itemsOf(resume));
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
