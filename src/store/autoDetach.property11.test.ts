import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { findRawItem } from "./findRawItem";
import { linkState, resolveItem } from "./resolve";
import {
  arbDetachedItemScenario,
  arbLinkedItemScenario,
  arbLocalItemScenario,
} from "./resolveArbitraries";
import type { ItemScenario, LinkedItemScenario } from "./resolveArbitraries";
import { useResumeStore } from "./resumeStore";
import type { BankItem, Bullet, Item, Resume } from "./schema";
import { useUiStore } from "./uiStore";

/**
 * Feature: item-bank-and-editor-ux, Property 11: Wording edits detach, visibility
 * edits do not
 *
 * For any linked item, applying a wording action (`updateItem`, `updateBullet`,
 * `addBullet`) leaves it detached with the edit stored locally, while applying a
 * visibility action (`toggleBulletHidden`, `reorderBullets`) leaves it linked
 * with the change stored in the overlay.
 *
 * Both halves live here:
 *  - wording half: the item ends "detached", bound to the same entry, with the
 *    edit stored locally, the bank untouched and the rendered projection equal
 *    to the one before modulo the edit;
 *  - visibility half: after EVERY action the item is still "linked" with an
 *    unchanged `link`, no local wording (`bullets` is `[]`, no content keys),
 *    the change sits in `hiddenBulletIds` / `bulletOrder` exactly as an
 *    independent model predicts, the resolved bullets match the model's
 *    projection, and the bank, other variants/sections/items and the toast list
 *    are untouched. Detached and local items keep the legacy behavior (flip
 *    `bullet.hidden`, reorder raw `bullets`). Finally, visibility actions
 *    followed by ONE wording action detach the item while keeping the user's
 *    hiding and order in the visible projection.
 *
 * Runs against the real store: each iteration loads a generated bank and two
 * variants (the current one holds the target item, bound to an existing entry
 * with an overlay of real and stale bullet ids), applies the action(s), and
 * compares the raw state and the resolved projection with the state before.
 *
 * **Validates: Requirements 7.1, 7.2, 8.1, 8.2**
 */

const NUM_RUNS = 150;
const CONTENT_KEYS = ["heading", "subheading", "location", "dateRange"] as const;
type ContentKey = (typeof CONTENT_KEYS)[number];

const arbText = fc.string({ maxLength: 20 });

/** A patch touching at least one wording field. */
const arbPatch = fc
  .record(
    { heading: arbText, subheading: arbText, location: arbText, dateRange: arbText },
    { requiredKeys: [] }
  )
  .filter((p) => Object.keys(p).length > 0);

/**
 * Wording actions as data. `pick` indexes (modulo) into the candidate bullet
 * ids at apply time, so the same descriptor works on every iteration and in
 * sequences, where the item's bullets change between steps.
 */
type WordingAction =
  | { type: "updateItem"; patch: Partial<Record<ContentKey, string>> }
  | { type: "updateBullet"; pick: number; text: string }
  | { type: "addBullet"; pick: number | undefined };

const arbAction: fc.Arbitrary<WordingAction> = fc.oneof(
  arbPatch.map((patch): WordingAction => ({ type: "updateItem", patch })),
  fc
    .record({ pick: fc.nat(), text: arbText })
    .map(({ pick, text }): WordingAction => ({ type: "updateBullet", pick, text })),
  fc
    .option(fc.nat(), { nil: undefined, freq: 2 })
    .map((pick): WordingAction => ({ type: "addBullet", pick }))
);

// --- store helpers -----------------------------------------------------------

const s = () => useResumeStore.getState();
const current = (): Resume => s().variants.find((v) => v.id === s().currentVariantId)!;
const rawTarget = (scn: LinkedItemScenario): Item =>
  findRawItem(current(), scn.sectionId, scn.itemId)!;
const entryOf = (item: Item): BankItem | undefined =>
  s().bank.find((b) => b.id === item.link?.bankId);
const visible = (bullets: readonly Bullet[]): Bullet[] => bullets.filter((b) => !b.hidden);

function load(scn: LinkedItemScenario) {
  useUiStore.setState({ toasts: [] });
  useResumeStore.setState({
    variants: scn.variants,
    currentVariantId: scn.currentVariantId,
    bank: scn.bank,
  });
}

/**
 * Ids a bullet-level action can name right now: the entry's bullets while the
 * item is linked (its raw bullets are empty), its own bullets once detached.
 */
function candidateIds(scn: LinkedItemScenario): string[] {
  const item = rawTarget(scn);
  if (linkState(item) === "linked") return entryOf(item)?.bullets.map((b) => b.id) ?? [];
  return item.bullets.map((b) => b.id);
}

const pickId = (ids: string[], pick: number | undefined): string | undefined =>
  pick === undefined || ids.length === 0 ? undefined : ids[pick % ids.length];

interface Applied {
  action: WordingAction;
  /** updateBullet: the id edited. addBullet: the id returned; afterId: the anchor passed. */
  bulletId?: string;
  afterId?: string;
}

function apply(action: WordingAction, scn: LinkedItemScenario): Applied {
  const { sectionId, itemId } = scn;
  const ids = candidateIds(scn);
  switch (action.type) {
    case "updateItem":
      s().updateItem(sectionId, itemId, action.patch);
      return { action };
    case "updateBullet": {
      // With no bullets to name, edit a missing id: still a wording edit.
      const bulletId = pickId(ids, action.pick) ?? "missing-0";
      s().updateBullet(sectionId, itemId, bulletId, action.text);
      return { action, bulletId };
    }
    case "addBullet": {
      const afterId = pickId(ids, action.pick);
      const bulletId = s().addBullet(sectionId, itemId, afterId);
      expect(bulletId).toBeTruthy();
      return { action, bulletId: bulletId!, afterId };
    }
  }
}

/** References of everything that must not be touched by an edit to the target. */
function snapshotBystanders(scn: LinkedItemScenario) {
  const variant = current();
  return {
    bank: s().bank,
    bankClone: structuredClone(s().bank),
    otherVariants: s().variants.filter((v) => v.id !== variant.id),
    otherSections: variant.sections.filter((sec) => sec.id !== scn.sectionId),
    otherItems: variant.sections.flatMap((sec) =>
      sec.items
        .filter((i) => !(sec.id === scn.sectionId && i.id === scn.itemId))
        .map((item) => ({ sectionId: sec.id, item }))
    ),
  };
}

function expectBystandersUntouched(
  scn: LinkedItemScenario,
  before: ReturnType<typeof snapshotBystanders>
) {
  // Bank: same array AND same content.
  expect(s().bank).toBe(before.bank);
  expect(s().bank).toStrictEqual(before.bankClone);
  // Other variants: same objects.
  const otherVariants = s().variants.filter((v) => v.id !== s().currentVariantId);
  expect(otherVariants).toHaveLength(before.otherVariants.length);
  otherVariants.forEach((v, i) => expect(v).toBe(before.otherVariants[i]));
  // Other sections and other items in the current variant: same objects.
  const sections = current().sections.filter((sec) => sec.id !== scn.sectionId);
  expect(sections).toHaveLength(before.otherSections.length);
  sections.forEach((sec, i) => expect(sec).toBe(before.otherSections[i]));
  for (const { sectionId, item } of before.otherItems) {
    expect(findRawItem(current(), sectionId, item.id)).toBe(item);
  }
}

/**
 * The rendered projection of a freshly detached item equals the pre-action
 * resolved view modulo the edit: unedited content fields match, the visible
 * bullets match (with the edit applied / the new bullet present).
 */
function expectProjection(
  resolvedBefore: Item,
  after: Item,
  action: WordingAction,
  applied: Applied
) {
  const preVisible = visible(resolvedBefore.bullets);
  for (const key of CONTENT_KEYS) {
    const edited = action.type === "updateItem" && key in action.patch;
    if (!edited) expect(after[key]).toBe(resolvedBefore[key]);
  }
  const postVisible = visible(after.bullets);
  if (action.type === "updateBullet") {
    expect(postVisible).toStrictEqual(
      preVisible.map((b) => (b.id === applied.bulletId ? { ...b, text: action.text } : b))
    );
  } else if (action.type === "addBullet") {
    expect(postVisible.filter((b) => b.id !== applied.bulletId)).toStrictEqual(preVisible);
    expect(postVisible.some((b) => b.id === applied.bulletId)).toBe(true);
  } else {
    expect(postVisible).toStrictEqual(preVisible);
  }
}

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
});

describe("Property 11 (wording half): wording edits detach the item and land locally", () => {
  it("updateItem / updateBullet / addBullet on a linked item detach it with the edit stored locally", () => {
    fc.assert(
      fc.property(arbLinkedItemScenario(), arbAction, (scn, action) => {
        load(scn);
        const before = rawTarget(scn);
        const entry = entryOf(before)!;
        expect(linkState(before)).toBe("linked");
        const resolvedBefore = resolveItem(before, new Map(s().bank.map((b) => [b.id, b])));
        const bystanders = snapshotBystanders(scn);

        const applied = apply(action, scn);
        const after = rawTarget(scn);

        // (a) detached, still bound to the same entry.
        expect(linkState(after)).toBe("detached");
        expect(after.link?.bankId).toBe(before.link!.bankId);
        expect(after.id).toBe(before.id);
        expect(after.hidden).toBe(before.hidden);

        // (b) the edit is stored locally on the item.
        if (action.type === "updateItem") {
          for (const key of CONTENT_KEYS) {
            if (key in action.patch) expect(after[key]).toBe(action.patch[key]);
          }
        } else if (action.type === "updateBullet") {
          const edited = after.bullets.find((b) => b.id === applied.bulletId);
          if (entry.bullets.some((b) => b.id === applied.bulletId)) {
            expect(edited?.text).toBe(action.text);
          } else {
            expect(edited).toBeUndefined(); // naming no bullet changes no bullet
          }
        } else {
          const at = after.bullets.findIndex((b) => b.id === applied.bulletId);
          expect(at).toBeGreaterThanOrEqual(0);
          expect(after.bullets[at]).toStrictEqual({ id: applied.bulletId, text: "" });
          const anchor = after.bullets.findIndex((b) => b.id === applied.afterId);
          if (applied.afterId !== undefined && anchor !== -1) {
            expect(at).toBe(anchor + 1); // inserted right after afterId
          } else {
            expect(at).toBe(after.bullets.length - 1); // appended
          }
        }

        // (c) the bank, other variants and other items are untouched.
        expectBystandersUntouched(scn, bystanders);

        // (d) the rendered projection is the pre-action one modulo the edit.
        expectProjection(resolvedBefore, after, action, applied);

        // (e) overlay keys are gone; overlay-hidden bank bullets are kept, flagged hidden.
        expect("hiddenBulletIds" in after).toBe(false);
        expect("bulletOrder" in after).toBe(false);
        const overlayHidden = new Set(before.hiddenBulletIds ?? []);
        const keptIds = after.bullets
          .map((b) => b.id)
          .filter((id) => action.type !== "addBullet" || id !== applied.bulletId);
        expect([...keptIds].sort()).toStrictEqual(entry.bullets.map((b) => b.id).sort());
        for (const bankBullet of entry.bullets) {
          const kept = after.bullets.find((b) => b.id === bankBullet.id)!;
          if (overlayHidden.has(bankBullet.id)) expect(kept.hidden).toBe(true);
          else expect(kept.hidden).toBe(bankBullet.hidden);
        }

        // No toast is pushed for an automatic detach.
        expect(useUiStore.getState().toasts).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("a sequence of 1-5 wording actions keeps the item detached, the bank untouched and bullet ids unique", () => {
    fc.assert(
      fc.property(
        arbLinkedItemScenario(),
        fc.array(arbAction, { minLength: 1, maxLength: 5 }),
        (scn, actions) => {
          load(scn);
          const bankBefore = s().bank;
          const bankClone = structuredClone(bankBefore);
          const bystanders = snapshotBystanders(scn);
          const bankId = rawTarget(scn).link!.bankId;

          for (const action of actions) {
            apply(action, scn);
            const item = rawTarget(scn);
            expect(linkState(item)).toBe("detached");
            expect(item.link?.bankId).toBe(bankId);
          }

          const ids = rawTarget(scn).bullets.map((b) => b.id);
          expect(new Set(ids).size).toBe(ids.length);
          expect(s().bank).toBe(bankBefore);
          expect(s().bank).toStrictEqual(bankClone);
          expectBystandersUntouched(scn, bystanders);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});


// --- visibility half ---------------------------------------------------------

/**
 * Visibility actions as data. `pick` / `picks` index (modulo) into a pool made
 * of the entry's bullet ids (shown, overlay-hidden and bank-hidden alike) plus
 * two ids no entry has, so stale ids are always in play.
 */
type BulletVisibilityAction =
  | { type: "toggleBulletHidden"; pick: number }
  | { type: "reorderBullets"; picks: number[] };

const arbBulletVisibilityAction: fc.Arbitrary<BulletVisibilityAction> = fc.oneof(
  fc.nat().map((pick): BulletVisibilityAction => ({ type: "toggleBulletHidden", pick })),
  fc
    .array(fc.nat(), { maxLength: 10 }) // empty, repeats and stale ids all occur
    .map((picks): BulletVisibilityAction => ({ type: "reorderBullets", picks }))
);

const STALE_IDS = ["missing-stale-1", "bul-99"];

/** Entry bullet ids first, then ids the entry does not have. */
const idPool = (entryIds: readonly string[]): string[] => [...entryIds, ...STALE_IDS];
const poolId = (pool: readonly string[], pick: number): string => pool[pick % pool.length];

function applyVisibility(
  scn: ItemScenario,
  action: BulletVisibilityAction,
  pool: readonly string[]
): string[] | string {
  if (action.type === "toggleBulletHidden") {
    const id = poolId(pool, action.pick);
    s().toggleBulletHidden(scn.sectionId, scn.itemId, id);
    return id;
  }
  const order = action.picks.map((n) => poolId(pool, n));
  s().reorderBullets(scn.sectionId, scn.itemId, order);
  return order;
}

/** The overlay as an independent model tracks it: absent key == empty list. */
interface OverlayModel {
  hidden: string[];
  order: string[];
}

/** Update the model by the documented rules (design §4.3), not by reading the store. */
function stepModel(
  model: OverlayModel,
  action: BulletVisibilityAction,
  entryIds: ReadonlySet<string>,
  arg: string[] | string
): OverlayModel {
  if (action.type === "toggleBulletHidden") {
    const id = arg as string;
    if (!entryIds.has(id)) return model; // stale id: ignored
    return {
      ...model,
      hidden: model.hidden.includes(id)
        ? model.hidden.filter((h) => h !== id)
        : [...model.hidden, id],
    };
  }
  const order: string[] = [];
  for (const id of arg as string[]) {
    if (entryIds.has(id) && !order.includes(id)) order.push(id);
  }
  return { ...model, order };
}

/**
 * What the item must show given the model: entry bullets minus the hidden ids,
 * ordered by the model's order (first occurrence, ids not shown skipped), then
 * the remaining bullets in entry order.
 */
function expectedResolvedBullets(entry: BankItem, model: OverlayModel): Bullet[] {
  const shown = entry.bullets.filter((b) => !model.hidden.includes(b.id));
  const first: Bullet[] = [];
  for (const id of model.order) {
    const b = shown.find((x) => x.id === id);
    if (b && !first.includes(b)) first.push(b);
  }
  return [...first, ...shown.filter((b) => !first.includes(b))];
}

describe("Property 11 (visibility half): visibility actions leave the item linked, the change in the overlay", () => {
  it("toggleBulletHidden / reorderBullets on a linked item never detach, store the change in the overlay, and resolve as the model predicts", () => {
    fc.assert(
      fc.property(
        arbLinkedItemScenario(),
        fc.array(arbBulletVisibilityAction, { minLength: 1, maxLength: 6 }),
        (scn, actions) => {
          load(scn);
          const initial = rawTarget(scn);
          const entry = entryOf(initial)!;
          expect(linkState(initial)).toBe("linked");
          const linkBefore = structuredClone(initial.link);
          const entryIds = new Set(entry.bullets.map((b) => b.id));
          const pool = idPool(entry.bullets.map((b) => b.id));
          const bystanders = snapshotBystanders(scn);
          let model: OverlayModel = {
            hidden: [...(initial.hiddenBulletIds ?? [])],
            order: [...(initial.bulletOrder ?? [])],
          };

          for (const action of actions) {
            const arg = applyVisibility(scn, action, pool);
            model = stepModel(model, action, entryIds, arg);
            const item = rawTarget(scn);

            // (a) still linked, link unchanged, no local wording accumulated.
            expect(linkState(item)).toBe("linked");
            expect(item.link).toStrictEqual(linkBefore);
            expect(item.bullets).toStrictEqual([]);
            for (const key of CONTENT_KEYS) expect(key in item).toBe(false);

            // (b) the change is stored in the overlay, as the model says.
            expect(item.hiddenBulletIds ?? []).toStrictEqual(model.hidden);
            expect(item.bulletOrder ?? []).toStrictEqual(model.order);

            // (c) the resolved projection is the model's expectation.
            const resolved = resolveItem(item, new Map(s().bank.map((b) => [b.id, b])));
            expect(resolved.bullets).toStrictEqual(expectedResolvedBullets(entry, model));

            // (d) bank, other variants, sections and items untouched; no toast.
            expectBystandersUntouched(scn, bystanders);
            expect(useUiStore.getState().toasts).toHaveLength(0);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("on a detached or local item they still flip bullet.hidden / reorder raw bullets and leave the bank alone", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbDetachedItemScenario(), arbLocalItemScenario()),
        fc.array(arbBulletVisibilityAction, { minLength: 1, maxLength: 6 }),
        (scn, actions) => {
          load(scn);
          const initial = rawTarget(scn);
          const stateBefore = linkState(initial);
          const linkBefore = structuredClone(initial.link);
          let model: Bullet[] = structuredClone(initial.bullets);
          const bystanders = snapshotBystanders(scn);

          for (const action of actions) {
            const pool = idPool(model.map((b) => b.id));
            const arg = applyVisibility(scn, action, pool);
            if (action.type === "toggleBulletHidden") {
              model = model.map((b) => (b.id === arg ? { ...b, hidden: !b.hidden } : b));
            } else {
              const named = [...new Set(arg as string[])].flatMap((id) =>
                model.filter((b) => b.id === id)
              );
              model = [...named, ...model.filter((b) => !named.includes(b))];
            }
            const item = rawTarget(scn);
            expect(linkState(item)).toBe(stateBefore);
            expect(item.link).toStrictEqual(linkBefore);
            expect(item.bullets).toStrictEqual(model);
            expectBystandersUntouched(scn, bystanders);
            expect(useUiStore.getState().toasts).toHaveLength(0);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("hiding / reordering and then ONE wording action detaches the item and keeps the user's hiding and order", () => {
    fc.assert(
      fc.property(
        arbLinkedItemScenario(),
        fc.array(arbBulletVisibilityAction, { minLength: 1, maxLength: 6 }),
        arbAction,
        (scn, visibilityActions, wording) => {
          load(scn);
          const entry = entryOf(rawTarget(scn))!;
          const pool = idPool(entry.bullets.map((b) => b.id));
          const bankBefore = s().bank;
          const bankClone = structuredClone(bankBefore);
          const bankId = rawTarget(scn).link!.bankId;

          for (const action of visibilityActions) applyVisibility(scn, action, pool);
          expect(linkState(rawTarget(scn))).toBe("linked");

          const linkedNow = rawTarget(scn);
          const resolvedBefore = resolveItem(linkedNow, new Map(s().bank.map((b) => [b.id, b])));
          const overlayHidden = new Set(linkedNow.hiddenBulletIds ?? []);
          const applied = apply(wording, scn);
          const after = rawTarget(scn);

          expect(linkState(after)).toBe("detached");
          expect(after.link?.bankId).toBe(bankId);
          // What was shown before the edit is shown after it, in the same order, modulo the edit.
          expectProjection(resolvedBefore, after, wording, applied);
          // The hidden-by-overlay bullets are kept, flagged hidden (nothing is lost).
          for (const b of entry.bullets) {
            const kept = after.bullets.find((x) => x.id === b.id)!;
            expect(kept.hidden).toBe(overlayHidden.has(b.id) ? true : b.hidden);
          }
          expect("hiddenBulletIds" in after).toBe(false);
          expect("bulletOrder" in after).toBe(false);
          expect(s().bank).toBe(bankBefore);
          expect(s().bank).toStrictEqual(bankClone);
          expect(useUiStore.getState().toasts).toHaveLength(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
