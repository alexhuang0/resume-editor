import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseImport, resumeJsonPayload } from "./importExport";
import { linkState, resolveResume } from "../store/resolve";
import { arbResumeAndBank } from "../store/resolveArbitraries";
import type { BankItem, Item, Resume } from "../store/schema";

/**
 * Feature: item-bank-and-editor-ux, Property 16: Export then import preserves
 * identity and rendering.
 *
 * For any variant and bank — including variants whose linked items carry
 * non-empty `hiddenBulletIds` / `bulletOrder` overlays, and variants with
 * detached items and dangling (orphaned) links — exporting the variant through
 * the REAL serializer (`resumeJsonPayload`, i.e. `resolveResume` + strip the
 * UI-only `orphaned` flag) and re-importing it through the REAL `parseImport`
 * against the SAME bank yields a variant that:
 *   - renders deep-equal to the original (what `ResumePreview` / `toMarkdown`
 *     would show, i.e. the resolved view with hidden bullets filtered out);
 *   - keeps every section id, item id and bullet id;
 *   - keeps link state and overlay on items whose bank entry still exists;
 *   - diverges from the bank zero times.
 *
 * This is the no-op round trip over the real export + import path, so it is the
 * end-to-end guard behind the overlay-divergence bug the demo calls out: hide a
 * bullet on a linked item, export, re-import with no edits, and the count must
 * be zero with the item still linked.
 *
 * The comparison is on the RENDERED view, not raw internal shape, because the
 * real reconciler legitimately rewrites some internals on a faithful round trip
 * without changing what the user sees (design §4.7, task 9.4):
 *   - an inlined linked item that matches the bank keeps its link + overlay but
 *     has its duplicated wording dropped (`bullets: []`, content keys omitted) —
 *     it resolves back to the same thing;
 *   - a linked item whose bank entry is gone (orphaned) is exported with empty
 *     content and comes back as a local empty item — still renders empty.
 * Both are invisible to the page, which is exactly what "preserves rendering"
 * means here.
 *
 * **Validates: Requirements 10.1, 10.2, 10.5**
 */

const NUM_RUNS = 200;

/** The visible, rendered projection of a resolved item: content fields plus
 * the bullets with `hidden` filtered out, keyed by `(id, text)` in order —
 * exactly what `ResumePreview` and `toMarkdown` put on the page. The item id
 * and `hidden` flag ride along so identity and item-level visibility are part
 * of the comparison. */
function renderedItem(item: Item) {
  return {
    id: item.id,
    hidden: item.hidden === true,
    heading: item.heading ?? "",
    subheading: item.subheading ?? "",
    location: item.location ?? "",
    dateRange: item.dateRange ?? "",
    bullets: item.bullets
      .filter((b) => b.hidden !== true)
      .map((b) => ({ id: b.id, text: b.text })),
  };
}

/** The rendered projection of a whole variant: section identity + order, item
 * order, and each item's visible content. This is the page. */
function renderedResume(variant: Resume) {
  return {
    name: variant.name,
    header: variant.header,
    sections: variant.sections.map((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      hidden: s.hidden === true,
      items: s.items.map(renderedItem),
    })),
  };
}

/** Export via the real payload fn, then re-import against the SAME bank. */
function roundTrip(variant: Resume, bank: BankItem[]): { resume: Resume; diverged: number } {
  const json = resumeJsonPayload(variant, bank);
  const parsed = parseImport(json, { getCurrentBank: () => bank });
  if (parsed.kind !== "resume") throw new Error(`expected resume, got ${parsed.kind}`);
  return { resume: parsed.resume, diverged: parsed.diverged };
}

/** All items of a variant, flattened, in document order. */
function allItems(variant: Resume): Item[] {
  return variant.sections.flatMap((s) => s.items);
}

describe("Property 16: export then import preserves rendering and never diverges", () => {
  it("the resolved page is deep-equal across the round trip, and the count is zero", () => {
    fc.assert(
      fc.property(arbResumeAndBank(), ({ resume, bank }) => {
        const { resume: back, diverged } = roundTrip(resume, bank);

        // No edits were made, so nothing diverges — this is the clause that
        // catches the overlay bug (a stray non-empty overlay reading as a
        // content change).
        expect(diverged).toBe(0);

        // The rendered page is identical before and after. Resolve both sides
        // against the same bank and compare the visible projection.
        const beforeRendered = renderedResume(resolveResume(resume, bank));
        const afterRendered = renderedResume(resolveResume(back, bank));
        expect(afterRendered).toStrictEqual(beforeRendered);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("every section id and item id survives the round trip, in order", () => {
    fc.assert(
      fc.property(arbResumeAndBank(), ({ resume, bank }) => {
        const { resume: back } = roundTrip(resume, bank);

        expect(back.sections.map((s) => s.id)).toStrictEqual(
          resume.sections.map((s) => s.id)
        );
        for (let i = 0; i < resume.sections.length; i++) {
          expect(back.sections[i].items.map((it) => it.id)).toStrictEqual(
            resume.sections[i].items.map((it) => it.id)
          );
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("link state and overlay survive for items whose bank entry still exists", () => {
    fc.assert(
      fc.property(arbResumeAndBank(), ({ resume, bank }) => {
        const { resume: back } = roundTrip(resume, bank);
        const bankIds = new Set(bank.map((b) => b.id));

        const beforeItems = allItems(resume);
        const afterItems = allItems(back);
        expect(afterItems.length).toBe(beforeItems.length);

        for (let i = 0; i < beforeItems.length; i++) {
          const before = beforeItems[i];
          const after = afterItems[i];
          expect(after.id).toBe(before.id);

          // Link state after the round trip, by the reconciler's branches
          // (design §4.7), and the one documented exception:
          //
          //   - local (no link): stays local;
          //   - detached: passed through UNTOUCHED whether or not the bank
          //     entry exists (branch 2) — its wording is the user's, so link
          //     state and content survive verbatim either way;
          //   - linked (not detached), entry present: stays linked, overlay
          //     kept verbatim (branches 4a/4b);
          //   - linked (not detached), entry GONE: an ORPHAN. The reconciler
          //     drops the dangling link and the now-meaningless overlay and
          //     keeps it as a local item (branch 3). This is the single
          //     documented exception to "link state preserved"; it does not
          //     change rendering (empty before, empty after), so the rendering
          //     test above still covers it.
          const entryExists = !!before.link && bankIds.has(before.link.bankId);
          const beforeState = linkState(before);

          if (beforeState === "local") {
            expect(linkState(after)).toBe("local");
          } else if (beforeState === "detached") {
            // Passed through untouched regardless of a dangling link.
            expect(linkState(after)).toBe("detached");
            expect(after.link?.bankId).toBe(before.link!.bankId);
          } else if (entryExists) {
            // Linked, entry present: still linked, overlay intact.
            expect(linkState(after)).toBe("linked");
            expect(after.link?.bankId).toBe(before.link!.bankId);
            expect(after.hiddenBulletIds).toStrictEqual(before.hiddenBulletIds);
            expect(after.bulletOrder).toStrictEqual(before.bulletOrder);
          } else {
            // Orphaned link: dropped to local on re-import. Documented residue.
            expect(linkState(after)).toBe("local");
          }
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("is idempotent: a second round trip changes nothing and still counts zero", () => {
    fc.assert(
      fc.property(arbResumeAndBank(), ({ resume, bank }) => {
        const first = roundTrip(resume, bank);
        const second = roundTrip(first.resume, bank);
        expect(second.diverged).toBe(0);
        // The export payload is a fixed point after the first import.
        expect(resumeJsonPayload(second.resume, bank)).toBe(
          resumeJsonPayload(first.resume, bank)
        );
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
