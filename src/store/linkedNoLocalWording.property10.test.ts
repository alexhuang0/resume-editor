import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { findRawItem } from "./findRawItem";
import { linkState } from "./resolve";
import { arbLinkedItemScenario } from "./resolveArbitraries";
import type { LinkedItemScenario } from "./resolveArbitraries";
import { useResumeStore } from "./resumeStore";
import type { BankItemPatch } from "./resumeStore";
import type { BankItem, Item, Resume } from "./schema";
import { useUiStore } from "./uiStore";

/**
 * Feature: item-bank-and-editor-ux, Property 10: Linked items never accumulate
 * local wording
 *
 * For any linked item and any sequence of non-detaching actions (toggle bullet
 * hidden, reorder bullets, toggle item hidden, reorder items, bank-side edits,
 * adding or duplicating items, and the actions that END with an item linked:
 * promote, fork, push), every linked item in every variant stores no wording
 * of its own: `bullets` is empty, none of `heading`/`subheading`/`location`/
 * `dateRange` is present, the link is `{ bankId }` only (no truthy `detached`)
 * and the overlay fields are plain string arrays.
 *
 * The complementary half: when a sequence ends with a wording action
 * (`updateItem` heading, `updateBullet`, `addBullet`), the edited item is
 * detached and holds the wording, and the invariant still holds for every
 * item that is still linked.
 *
 * Runs against the real store. Each iteration loads a generated bank and two
 * variants (the current one holds a linked target among items of every link
 * state) and checks the invariant on EVERY item of EVERY variant after EVERY
 * action, not only on the target.
 *
 * **Validates: Requirements 5.4**
 */

const NUM_RUNS = 150;
const WORDING_KEYS = ["heading", "subheading", "location", "dateRange"] as const;

const arbText = fc.string({ maxLength: 20 });
/** Item reference: `undefined` is the scenario's target, a number indexes any item of the current variant. */
const arbRef = fc.option(fc.nat(), { nil: undefined, freq: 2 });
const arbKeys = fc.array(fc.nat(), { maxLength: 8 });
const arbOverlayId = fc.oneof(
  fc.integer({ min: 0, max: 9 }).map((n) => `bul-${n}`),
  fc.constant("missing-bul")
);

type OverlayPatch = Pick<Item, "hidden" | "hiddenBulletIds" | "bulletOrder">;

/** Non-detaching actions as data; picks and refs resolve (modulo) at apply time. */
type Act =
  | { t: "toggleItemHidden"; ref: number | undefined }
  | { t: "reorderItems"; ref: number | undefined; keys: number[] }
  | { t: "toggleBulletHidden"; ref: number | undefined; pick: number; stale: boolean }
  | { t: "reorderBullets"; ref: number | undefined; keys: number[] }
  | { t: "updateItemOverlay"; ref: number | undefined; patch: OverlayPatch }
  | { t: "updateBankItem"; bank: number; patch: BankItemPatch }
  | { t: "addBankBullet"; bank: number; pick: number | undefined }
  | { t: "updateBankBullet"; bank: number; pick: number; text: string }
  | { t: "deleteBankBullet"; bank: number; pick: number }
  | { t: "reorderBankBullets"; bank: number; keys: number[] }
  | { t: "renameBankItemLabel"; bank: number; label: string }
  | { t: "duplicateBankItem"; bank: number }
  | { t: "addItemFromBank"; ref: number | undefined; bank: number; after: boolean }
  | { t: "duplicateItem"; ref: number | undefined }
  | { t: "duplicateSection"; ref: number | undefined }
  | { t: "promote"; ref: number | undefined }
  | { t: "fork"; ref: number | undefined }
  | { t: "push"; ref: number | undefined }
  | { t: "unknownIds" };

const arbOverlayPatch: fc.Arbitrary<OverlayPatch> = fc
  .record(
    {
      hidden: fc.boolean(),
      hiddenBulletIds: fc.array(arbOverlayId, { maxLength: 4 }),
      bulletOrder: fc.array(arbOverlayId, { maxLength: 4 }),
    },
    { requiredKeys: [] }
  )
  .filter((p) => Object.keys(p).length > 0);

const arbBankPatch: fc.Arbitrary<BankItemPatch> = fc.record(
  { heading: arbText, subheading: arbText, location: arbText, dateRange: arbText, label: arbText },
  { requiredKeys: [] }
);

const arbAct: fc.Arbitrary<Act> = fc.oneof(
  arbRef.map((ref): Act => ({ t: "toggleItemHidden", ref })),
  fc.record({ ref: arbRef, keys: arbKeys }).map((r): Act => ({ t: "reorderItems", ...r })),
  fc
    .record({ ref: arbRef, pick: fc.nat(), stale: fc.boolean() })
    .map((r): Act => ({ t: "toggleBulletHidden", ...r })),
  fc.record({ ref: arbRef, keys: arbKeys }).map((r): Act => ({ t: "reorderBullets", ...r })),
  fc.record({ ref: arbRef, patch: arbOverlayPatch }).map((r): Act => ({ t: "updateItemOverlay", ...r })),
  fc.record({ bank: fc.nat(), patch: arbBankPatch }).map((r): Act => ({ t: "updateBankItem", ...r })),
  fc
    .record({ bank: fc.nat(), pick: fc.option(fc.nat(), { nil: undefined }) })
    .map((r): Act => ({ t: "addBankBullet", ...r })),
  fc
    .record({ bank: fc.nat(), pick: fc.nat(), text: arbText })
    .map((r): Act => ({ t: "updateBankBullet", ...r })),
  fc.record({ bank: fc.nat(), pick: fc.nat() }).map((r): Act => ({ t: "deleteBankBullet", ...r })),
  fc.record({ bank: fc.nat(), keys: arbKeys }).map((r): Act => ({ t: "reorderBankBullets", ...r })),
  fc.record({ bank: fc.nat(), label: arbText }).map((r): Act => ({ t: "renameBankItemLabel", ...r })),
  fc.nat().map((bank): Act => ({ t: "duplicateBankItem", bank })),
  fc
    .record({ ref: arbRef, bank: fc.nat(), after: fc.boolean() })
    .map((r): Act => ({ t: "addItemFromBank", ...r })),
  arbRef.map((ref): Act => ({ t: "duplicateItem", ref })),
  arbRef.map((ref): Act => ({ t: "duplicateSection", ref })),
  arbRef.map((ref): Act => ({ t: "promote", ref })),
  arbRef.map((ref): Act => ({ t: "fork", ref })),
  arbRef.map((ref): Act => ({ t: "push", ref })),
  fc.constant<Act>({ t: "unknownIds" })
);

// --- store helpers -----------------------------------------------------------

const s = () => useResumeStore.getState();
const current = (): Resume => s().variants.find((v) => v.id === s().currentVariantId)!;
const rawTarget = (scn: LinkedItemScenario): Item =>
  findRawItem(current(), scn.sectionId, scn.itemId)!;
const entryOf = (item: Item): BankItem | undefined =>
  s().bank.find((b) => b.id === item.link?.bankId);

function load(scn: LinkedItemScenario) {
  useUiStore.setState({ toasts: [] });
  useResumeStore.setState({
    variants: scn.variants,
    currentVariantId: scn.currentVariantId,
    bank: scn.bank,
  });
}

interface Ref {
  sectionId: string;
  itemId: string;
}

function resolveRef(ref: number | undefined, scn: LinkedItemScenario): Ref {
  if (ref === undefined) return { sectionId: scn.sectionId, itemId: scn.itemId };
  const all = current().sections.flatMap((sec) =>
    sec.items.map((i) => ({ sectionId: sec.id, itemId: i.id }))
  );
  return all[ref % all.length];
}

/** Ids a bullet-level action can name: the entry's bullets while linked, the item's own otherwise. */
function candidateIds(item: Item): string[] {
  if (linkState(item) === "linked") return entryOf(item)?.bullets.map((b) => b.id) ?? [];
  return item.bullets.map((b) => b.id);
}

const pickId = (ids: string[], pick: number | undefined): string | undefined =>
  pick === undefined || ids.length === 0 ? undefined : ids[pick % ids.length];

const bankAt = (n: number): BankItem => s().bank[n % s().bank.length];

const byKeys = (ids: string[], keys: number[]): string[] =>
  ids
    .map((id, i) => ({ id, key: keys[i % Math.max(keys.length, 1)] ?? 0 }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.id);

// --- the invariant -----------------------------------------------------------

function expectNoWording(item: Item, where: string) {
  expect(item.bullets, `${where}: bullets`).toStrictEqual([]);
  for (const key of WORDING_KEYS) {
    expect(key in item, `${where}: "${key}" key present`).toBe(false);
  }
  expect(Object.keys(item.link ?? {}).every((k) => k === "bankId" || k === "detached")).toBe(true);
  expect(item.link!.detached, `${where}: link.detached`).toBeFalsy();
  for (const key of ["hiddenBulletIds", "bulletOrder"] as const) {
    const ids = item[key];
    if (ids !== undefined) {
      expect(Array.isArray(ids), `${where}: ${key} is an array`).toBe(true);
      expect(ids.every((id) => typeof id === "string")).toBe(true);
    }
  }
}

/** Every linked item of every variant stores no wording. Returns how many it checked. */
function expectAllLinkedItemsClean(): number {
  let checked = 0;
  for (const v of s().variants) {
    for (const sec of v.sections) {
      for (const item of sec.items) {
        if (linkState(item) !== "linked") continue;
        expectNoWording(item, `${v.id}/${sec.id}/${item.id}`);
        checked++;
      }
    }
  }
  return checked;
}

// --- applying actions --------------------------------------------------------

function apply(act: Act, scn: LinkedItemScenario) {
  switch (act.t) {
    case "toggleItemHidden": {
      const { sectionId, itemId } = resolveRef(act.ref, scn);
      s().toggleItemHidden(sectionId, itemId);
      break;
    }
    case "reorderItems": {
      const { sectionId } = resolveRef(act.ref, scn);
      const ids = current().sections.find((sec) => sec.id === sectionId)!.items.map((i) => i.id);
      s().reorderItems(sectionId, byKeys(ids, act.keys));
      break;
    }
    case "toggleBulletHidden": {
      const { sectionId, itemId } = resolveRef(act.ref, scn);
      const ids = candidateIds(findRawItem(current(), sectionId, itemId)!);
      const bulletId = act.stale ? "missing-bul" : (pickId(ids, act.pick) ?? "missing-bul");
      s().toggleBulletHidden(sectionId, itemId, bulletId);
      break;
    }
    case "reorderBullets": {
      const { sectionId, itemId } = resolveRef(act.ref, scn);
      const ids = candidateIds(findRawItem(current(), sectionId, itemId)!);
      s().reorderBullets(sectionId, itemId, byKeys([...ids, "missing-bul"], act.keys));
      break;
    }
    case "updateItemOverlay": {
      const { sectionId, itemId } = resolveRef(act.ref, scn);
      s().updateItem(sectionId, itemId, act.patch);
      break;
    }
    case "updateBankItem":
      s().updateBankItem(bankAt(act.bank).id, act.patch);
      break;
    case "addBankBullet": {
      const entry = bankAt(act.bank);
      const id = s().addBankBullet(entry.id, pickId(entry.bullets.map((b) => b.id), act.pick));
      expect(id).toBeTruthy();
      break;
    }
    case "updateBankBullet": {
      const entry = bankAt(act.bank);
      const id = pickId(entry.bullets.map((b) => b.id), act.pick);
      if (id) s().updateBankBullet(entry.id, id, act.text);
      break;
    }
    case "deleteBankBullet": {
      const entry = bankAt(act.bank);
      const id = pickId(entry.bullets.map((b) => b.id), act.pick);
      if (id) expect(s().deleteBankBullet(entry.id, id)).not.toBeNull();
      break;
    }
    case "reorderBankBullets": {
      const entry = bankAt(act.bank);
      s().reorderBankBullets(entry.id, byKeys(entry.bullets.map((b) => b.id), act.keys));
      break;
    }
    case "renameBankItemLabel":
      s().renameBankItemLabel(bankAt(act.bank).id, act.label);
      break;
    case "duplicateBankItem": {
      const before = s().bank.length;
      expect(s().duplicateBankItem(bankAt(act.bank).id)).toBeTruthy();
      expect(s().bank).toHaveLength(before + 1);
      break;
    }
    case "addItemFromBank": {
      const { sectionId, itemId } = resolveRef(act.ref, scn);
      const bankId = bankAt(act.bank).id;
      const id = s().addItemFromBank(sectionId, bankId, act.after ? itemId : undefined);
      expect(id).toBeTruthy();
      // Exactly the minimal linked shape: id, link, empty bullets.
      expect(findRawItem(current(), sectionId, id!)).toStrictEqual({
        id,
        link: { bankId },
        bullets: [],
      });
      break;
    }
    case "duplicateItem": {
      const { sectionId, itemId } = resolveRef(act.ref, scn);
      const before = findRawItem(current(), sectionId, itemId)!;
      const copyId = s().duplicateItem(sectionId, itemId);
      expect(copyId).toBeTruthy();
      const copy = findRawItem(current(), sectionId, copyId!)!;
      if (linkState(before) === "linked") {
        // A duplicate of a linked item clones the raw item: still linked to the
        // same entry, still no wording, same overlay.
        expect(linkState(copy)).toBe("linked");
        expect(copy.link!.bankId).toBe(before.link!.bankId);
        expect(copy.bullets).toStrictEqual([]);
        expect(copy.hiddenBulletIds).toStrictEqual(before.hiddenBulletIds);
        expect(copy.bulletOrder).toStrictEqual(before.bulletOrder);
      }
      break;
    }
    case "duplicateSection": {
      const { sectionId } = resolveRef(act.ref, scn);
      expect(s().duplicateSection(sectionId)).toBeTruthy();
      break;
    }
    case "promote": {
      const { sectionId, itemId } = resolveRef(act.ref, scn);
      const was = linkState(findRawItem(current(), sectionId, itemId)!);
      const bankId = s().promoteItemToBank(sectionId, itemId);
      expect(bankId === null).toBe(was !== "local");
      if (bankId) {
        const after = findRawItem(current(), sectionId, itemId)!;
        expect(linkState(after)).toBe("linked");
        expect(after.link).toStrictEqual({ bankId });
        expect(s().bank.some((b) => b.id === bankId)).toBe(true);
      }
      break;
    }
    case "fork": {
      const { sectionId, itemId } = resolveRef(act.ref, scn);
      const was = linkState(findRawItem(current(), sectionId, itemId)!);
      const bankId = s().forkItemToNewBankItem(sectionId, itemId);
      expect(bankId === null).toBe(was === "local");
      if (bankId) {
        const after = findRawItem(current(), sectionId, itemId)!;
        expect(linkState(after)).toBe("linked");
        expect(after.link).toStrictEqual({ bankId });
        expect(s().bank.some((b) => b.id === bankId)).toBe(true);
      }
      break;
    }
    case "push": {
      const { sectionId, itemId } = resolveRef(act.ref, scn);
      const before = findRawItem(current(), sectionId, itemId)!;
      const pushed = s().pushItemToBank(sectionId, itemId);
      const expected = linkState(before) === "detached" && entryOf(before) !== undefined;
      expect(pushed).toBe(expected);
      if (pushed) {
        const after = findRawItem(current(), sectionId, itemId)!;
        expect(linkState(after)).toBe("linked");
        expect(after.link).toStrictEqual({ bankId: before.link!.bankId });
      }
      break;
    }
    case "unknownIds": {
      // Stale and missing ids are harmless no-ops: sections and bank unchanged.
      const sectionsBefore = structuredClone(current().sections);
      const bankBefore = structuredClone(s().bank);
      const { sectionId, itemId } = resolveRef(undefined, scn);
      s().toggleItemHidden("missing-sec", itemId);
      s().toggleItemHidden(sectionId, "missing-item");
      s().reorderItems("missing-sec", [itemId]);
      s().updateItem("missing-sec", itemId, { hidden: true });
      s().updateItem(sectionId, "missing-item", { hiddenBulletIds: ["bul-0"] });
      s().toggleBulletHidden("missing-sec", itemId, "bul-0");
      s().toggleBulletHidden(sectionId, "missing-item", "bul-0");
      s().toggleBulletHidden(sectionId, itemId, "missing-bul"); // stale bullet on the linked target
      s().reorderBullets(sectionId, "missing-item", ["bul-0"]);
      s().updateBankItem("missing-bank", { heading: "x" });
      s().renameBankItemLabel("missing-bank", "x");
      s().updateBankBullet("missing-bank", "bul-0", "x");
      s().reorderBankBullets("missing-bank", ["bul-0"]);
      expect(s().addBankBullet("missing-bank")).toBeNull();
      expect(s().deleteBankBullet("missing-bank", "bul-0")).toBeNull();
      expect(s().duplicateBankItem("missing-bank")).toBeNull();
      expect(s().addItemFromBank("missing-sec", bankAt(0).id)).toBeNull();
      expect(s().addItemFromBank(sectionId, "missing-bank")).toBeNull();
      expect(s().duplicateItem("missing-sec", itemId)).toBeNull();
      expect(s().duplicateItem(sectionId, "missing-item")).toBeNull();
      expect(s().promoteItemToBank(sectionId, "missing-item")).toBeNull();
      expect(s().forkItemToNewBankItem("missing-sec", itemId)).toBeNull();
      expect(s().pushItemToBank(sectionId, "missing-item")).toBe(false);
      expect(current().sections).toStrictEqual(sectionsBefore);
      expect(s().bank).toStrictEqual(bankBefore);
      break;
    }
  }
}

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
});

describe("Property 10: linked items never accumulate local wording", () => {
  it("every linked item in every variant stores no wording after each action of a non-detaching sequence", () => {
    fc.assert(
      fc.property(
        arbLinkedItemScenario(),
        fc.array(arbAct, { minLength: 1, maxLength: 8 }),
        (scn, acts) => {
          load(scn);
          const bankId = rawTarget(scn).link!.bankId;
          expect(expectAllLinkedItemsClean()).toBeGreaterThan(0); // at least the target

          for (const act of acts) {
            apply(act, scn);

            expectAllLinkedItemsClean();
            // The sequence never detaches the target (fork may relink it elsewhere).
            const target = rawTarget(scn);
            expect(linkState(target)).toBe("linked");
            if (!acts.some((a) => a.t === "fork")) expect(target.link!.bankId).toBe(bankId);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("a sequence ending in a wording action leaves the edited item detached with the wording; no linked item has wording", () => {
    type Wording =
      | { t: "heading"; text: string }
      | { t: "updateBullet"; pick: number; text: string }
      | { t: "addBullet"; pick: number | undefined };
    const arbWording: fc.Arbitrary<Wording> = fc.oneof(
      arbText.map((text): Wording => ({ t: "heading", text })),
      fc.record({ pick: fc.nat(), text: arbText }).map((r): Wording => ({ t: "updateBullet", ...r })),
      fc.option(fc.nat(), { nil: undefined }).map((pick): Wording => ({ t: "addBullet", pick }))
    );

    fc.assert(
      fc.property(
        arbLinkedItemScenario(),
        fc.array(arbAct, { maxLength: 6 }),
        arbWording,
        (scn, acts, wording) => {
          load(scn);
          for (const act of acts) apply(act, scn);
          expectAllLinkedItemsClean();

          const { sectionId, itemId } = scn;
          const before = rawTarget(scn);
          expect(linkState(before)).toBe("linked");
          const ids = candidateIds(before);

          let bulletId: string | undefined;
          if (wording.t === "heading") {
            s().updateItem(sectionId, itemId, { heading: wording.text });
          } else if (wording.t === "updateBullet") {
            bulletId = pickId(ids, wording.pick);
            s().updateBullet(sectionId, itemId, bulletId ?? "missing-bul", wording.text);
          } else {
            bulletId = s().addBullet(sectionId, itemId, pickId(ids, wording.pick))!;
            expect(bulletId).toBeTruthy();
          }

          // The wording moved to a detached item...
          const after = rawTarget(scn);
          expect(linkState(after)).toBe("detached");
          expect(after.link!.bankId).toBe(before.link!.bankId);
          if (wording.t === "heading") expect(after.heading).toBe(wording.text);
          if (wording.t === "updateBullet" && bulletId) {
            expect(after.bullets.find((b) => b.id === bulletId)?.text).toBe(wording.text);
          }
          if (wording.t === "addBullet") {
            expect(after.bullets.some((b) => b.id === bulletId)).toBe(true);
          }
          // ...so no item that is still linked has any.
          expectAllLinkedItemsClean();
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
