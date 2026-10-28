import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { reconcileImportedItem } from "./reconcile";
import { resolveItem } from "./resolve";
import {
  arbBankItem,
  arbLinkedItem,
} from "./resolveArbitraries";
import type { BankItem, Bullet, Item } from "./schema";

/**
 * Feature: item-bank-and-editor-ux, Property 15: Divergence detection keeps
 * exactly what the user changed
 *
 * For any bank entry, any overlay, and any inlined copy of the overlay-resolved
 * view (the single-variant export shape), reconciling that copy against the
 * bank:
 *   - identity case: the inlined copy, untouched, stays LINKED, keeps its
 *     overlay (`hiddenBulletIds` / `bulletOrder`), carries no local wording,
 *     and is not diverged;
 *   - perturbed case: perturbing EXACTLY ONE thing — one of the four content
 *     fields, or one bullet's text / hidden flag, or one added / removed
 *     bullet — marks the item diverged and detached, and the reconciled result
 *     keeps the imported (perturbed) wording verbatim rather than snapping back
 *     to the bank, re-attaching overlay-hidden bullets as `hidden: true`;
 *   - complement: a change that is NOT a content difference under
 *     `contentEquals` — here, changing the overlay keys alone, which the export
 *     has already inlined into `bullets` — never flips the item to diverged.
 *
 * The reconciler compares the imported item against `resolveItem(imported,
 * bankById)` (the bank's wording as resolved under the item's OWN overlay),
 * never the raw bank entry, so a non-empty overlay on its own is not a
 * divergence.
 *
 * **Validates: Requirements 10.3, 10.4**
 */

const NUM_RUNS = 200;

const CONTENT_FIELDS = ["heading", "subheading", "location", "dateRange"] as const;

/** The four content fields plus the bullet list, as `contentEquals` compares them. */
function wording(item: { heading?: string; subheading?: string; location?: string; dateRange?: string; bullets: readonly Bullet[] }) {
  return {
    heading: item.heading ?? "",
    subheading: item.subheading ?? "",
    location: item.location ?? "",
    dateRange: item.dateRange ?? "",
    bullets: item.bullets.map((b) => ({ id: b.id, text: b.text, hidden: b.hidden === true })),
  };
}

/**
 * Build the single-variant EXPORT shape of a raw linked item: the overlay is
 * inlined into content fields + visible bullets, while `link`, `hiddenBulletIds`
 * and `bulletOrder` ride along as inert metadata. This is exactly what
 * `exportResumeAsJsonFile` writes (`resolveResume`), and the input to the
 * import-side reconciler.
 */
function inlinedExport(rawLinked: Item, bankById: Map<string, BankItem>): Item {
  const resolved = resolveItem(rawLinked, bankById);
  // `resolveItem` already produced the inlined view with content fields from
  // the bank, visible bullets in overlay order, and the overlay keys carried.
  // Round-trip through JSON so the operand is JSON-safe, matching a real file.
  return JSON.parse(JSON.stringify(resolved)) as Item;
}

/**
 * True when the inlined export carries at least some wording: a non-empty
 * content field or at least one (visible) bullet. An item with none at all is
 * indistinguishable from a raw library item and takes the pass-through branch
 * of the reconciler (design §4.7, "The one residue, accepted"), so these
 * generators exclude it to keep the identity clause ("stays linked, carries no
 * local wording") distinct from that residue.
 */
function hasWording(inlined: Item): boolean {
  const anyField = CONTENT_FIELDS.some((f) => ((inlined[f] as string | undefined) ?? "") !== "");
  return anyField || inlined.bullets.length > 0;
}

/**
 * A bank entry together with a raw linked item that references it (its bank id
 * always resolves) and the item's inlined export, constrained so the inlined
 * export carries real wording (see `hasWording`). The entry carries at least
 * one bullet so there is always something to perturb.
 */
const arbEntryAndInlined = arbBankItem
  .filter((e) => e.bullets.length >= 1)
  .chain((entry) =>
    arbLinkedItem([entry], 0).map((rawLinked) => {
      const bankById = new Map([[entry.id, entry]]);
      return { entry, bankById, rawLinked, inlined: inlinedExport(rawLinked, bankById) };
    })
  )
  .filter(({ inlined }) => hasWording(inlined));

describe("Property 15: identity — an untouched inlined copy stays linked", () => {
  it("keeps the link and overlay, carries no local wording, and is not diverged", () => {
    fc.assert(
      fc.property(arbEntryAndInlined, ({ inlined, bankById, rawLinked }) => {
        const r = reconcileImportedItem(inlined, bankById);

        expect(r.diverged).toBe(false);
        // Still linked (not detached) to the same entry: the link survives
        // verbatim (`detached` is absent or false, never flipped on).
        expect(r.item.link?.bankId).toBe(rawLinked.link!.bankId);
        expect(r.item.link?.detached).toBeFalsy();
        // Overlay preserved exactly as it rode in.
        expect(r.item.hiddenBulletIds).toEqual(inlined.hiddenBulletIds);
        expect(r.item.bulletOrder).toEqual(inlined.bulletOrder);
        // No local wording: a linked item stores none (Req 5.4).
        expect(r.item.bullets).toStrictEqual([]);
        for (const f of CONTENT_FIELDS) expect(f in r.item).toBe(false);
        // And it still resolves to exactly what the file showed.
        expect(wording(resolveItem(r.item, bankById))).toStrictEqual(wording(inlined));
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// --- perturbation generators: change EXACTLY ONE thing -----------------------

type Perturbation = { label: string; apply: (item: Item) => Item };

/** Change exactly one content field to a value that is guaranteed different. */
function arbFieldPerturbation(item: Item): fc.Arbitrary<Perturbation> {
  return fc
    .tuple(fc.constantFrom(...CONTENT_FIELDS), fc.string({ maxLength: 20 }))
    .map(([f, s]): Perturbation => {
      const current = (item[f] as string | undefined) ?? "";
      // Ensure the new value differs under `contentEquals` (undefined ≡ "").
      const next = s === current ? `${s}·changed` : s;
      return { label: `field:${f}`, apply: (it) => ({ ...it, [f]: next }) };
    });
}

/** Reword exactly one existing bullet (requires at least one bullet). */
function arbBulletTextPerturbation(item: Item): fc.Arbitrary<Perturbation> | null {
  if (item.bullets.length === 0) return null;
  return fc
    .tuple(fc.integer({ min: 0, max: item.bullets.length - 1 }), fc.string({ maxLength: 20 }))
    .map(([i, s]): Perturbation => {
      const current = item.bullets[i].text;
      const next = s === current ? `${s}·changed` : s;
      return {
        label: `bullet-text:${i}`,
        apply: (it) => ({
          ...it,
          bullets: it.bullets.map((b, j) => (j === i ? { ...b, text: next } : b)),
        }),
      };
    });
}

/** Flip exactly one existing bullet's `hidden` flag. */
function arbBulletHiddenPerturbation(item: Item): fc.Arbitrary<Perturbation> | null {
  if (item.bullets.length === 0) return null;
  return fc.integer({ min: 0, max: item.bullets.length - 1 }).map(
    (i): Perturbation => ({
      label: `bullet-hidden:${i}`,
      apply: (it) => ({
        ...it,
        bullets: it.bullets.map((b, j) => (j === i ? { ...b, hidden: !(b.hidden === true) } : b)),
      }),
    })
  );
}

/** Add exactly one new bullet (a fresh id not already present). */
function arbAddBulletPerturbation(item: Item): fc.Arbitrary<Perturbation> {
  const used = new Set(item.bullets.map((b) => b.id));
  return fc
    .tuple(
      fc.integer({ min: 0, max: item.bullets.length }),
      fc.string({ maxLength: 20 })
    )
    .map(([at, textRaw]): Perturbation => {
      let n = 0;
      let id = `added-${n}`;
      while (used.has(id)) id = `added-${++n}`;
      const bullet: Bullet = { id, text: textRaw };
      return {
        label: "bullet-add",
        apply: (it) => ({
          ...it,
          bullets: [...it.bullets.slice(0, at), bullet, ...it.bullets.slice(at)],
        }),
      };
    });
}

/** Remove exactly one existing bullet (requires at least one bullet). */
function arbRemoveBulletPerturbation(item: Item): fc.Arbitrary<Perturbation> | null {
  if (item.bullets.length === 0) return null;
  return fc.integer({ min: 0, max: item.bullets.length - 1 }).map(
    (i): Perturbation => ({
      label: `bullet-remove:${i}`,
      apply: (it) => ({ ...it, bullets: it.bullets.filter((_, j) => j !== i) }),
    })
  );
}

/** Any single-thing perturbation that is valid for this item. */
function arbPerturbation(item: Item): fc.Arbitrary<Perturbation> {
  const candidates = [
    arbFieldPerturbation(item),
    arbBulletTextPerturbation(item),
    arbBulletHiddenPerturbation(item),
    arbAddBulletPerturbation(item),
    arbRemoveBulletPerturbation(item),
  ].filter((a): a is fc.Arbitrary<Perturbation> => a !== null);
  return fc.oneof(...candidates);
}

describe("Property 15: perturb exactly one thing — diverged, detached, wording kept", () => {
  it("the reconciled item is detached and carries the perturbed wording verbatim", () => {
    fc.assert(
      fc.property(
        arbEntryAndInlined.chain((base) =>
          arbPerturbation(base.inlined).map((p) => ({ ...base, p }))
        ),
        ({ entry, bankById, inlined, p }) => {
          const perturbed = p.apply(inlined);
          // Precondition: the perturbation really changed the wording.
          fc.pre(
            JSON.stringify(wording(perturbed)) !== JSON.stringify(wording(inlined))
          );

          const r = reconcileImportedItem(perturbed, bankById);

          // Diverged and detached.
          expect(r.diverged).toBe(true);
          expect(r.item.link).toEqual({ bankId: entry.id, detached: true });
          // The overlay keys are cleared on a detach.
          expect("hiddenBulletIds" in r.item).toBe(false);
          expect("bulletOrder" in r.item).toBe(false);

          // Every content field is the user's perturbed value, verbatim.
          for (const f of CONTENT_FIELDS) {
            expect((r.item[f] as string | undefined) ?? "").toBe(
              (perturbed[f] as string | undefined) ?? ""
            );
          }

          // The perturbed bullets survive verbatim, in order, as the prefix of
          // the result; any extra bullets are overlay-hidden re-attachments.
          expect(r.item.bullets.slice(0, perturbed.bullets.length)).toStrictEqual(
            perturbed.bullets
          );
          // Everything the file showed as visible is still shown.
          expect(r.item.bullets.filter((b) => b.hidden !== true)).toStrictEqual(
            perturbed.bullets.filter((b) => b.hidden !== true)
          );
          // Any re-attached bullets are from the overlay's hidden set, flagged hidden.
          const extras = r.item.bullets.slice(perturbed.bullets.length);
          const hiddenByOverlay = new Set(inlined.hiddenBulletIds ?? []);
          const inlinedIds = new Set(perturbed.bullets.map((b) => b.id));
          for (const b of extras) {
            expect(b.hidden).toBe(true);
            expect(hiddenByOverlay.has(b.id)).toBe(true);
            expect(inlinedIds.has(b.id)).toBe(false);
            const fromBank = entry.bullets.find((x) => x.id === b.id)!;
            expect(b.text).toBe(fromBank.text);
          }

          // Detached, so the resolver returns it unchanged: the kept wording renders.
          expect(resolveItem(r.item, bankById)).toBe(r.item);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

describe("Property 15: complement — a non-empty overlay on its own is not a divergence", () => {
  it("an overlay that reorders/hides but changes no wording keeps the item linked", () => {
    fc.assert(
      fc.property(arbEntryAndInlined, ({ entry, bankById, inlined, rawLinked }) => {
        // The overlay (`hiddenBulletIds` / `bulletOrder`) is non-trivial here
        // often: the export already baked it into `bullets`. Reconciling must
        // not read that as a content change, because the reconciler compares
        // against the SAME overlay's resolved view (design §4.7 / 9.3), so a
        // non-empty overlay on its own is never a divergence.
        const r = reconcileImportedItem(inlined, bankById);

        expect(r.diverged).toBe(false);
        expect(r.item.link?.bankId).toBe(entry.id);
        expect(r.item.link?.detached).toBeFalsy();
        // Overlay preserved verbatim, no local wording stored.
        expect(r.item.hiddenBulletIds).toEqual(rawLinked.hiddenBulletIds);
        expect(r.item.bulletOrder).toEqual(rawLinked.bulletOrder);
        expect(r.item.bullets).toStrictEqual([]);
        for (const f of CONTENT_FIELDS) expect(f in r.item).toBe(false);
        // And it still renders exactly what the export file showed.
        expect(wording(resolveItem(r.item, bankById))).toStrictEqual(wording(inlined));
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe("Property 15: a detached import is passed through untouched", () => {
  it("an already-detached item keeps its wording and is never compared to the bank", () => {
    fc.assert(
      fc.property(
        arbEntryAndInlined.chain((base) =>
          arbPerturbation(base.inlined).map((p) => ({ ...base, p }))
        ),
        ({ bankById, inlined, p }) => {
          // Take a perturbed copy, mark it detached as a prior session would,
          // and feed it back: it must come through byte-for-byte.
          const detached: Item = {
            ...p.apply(inlined),
            link: { bankId: inlined.link!.bankId, detached: true },
          };
          const r = reconcileImportedItem(detached, bankById);
          expect(r.diverged).toBe(false);
          expect(r.item).toBe(detached);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
