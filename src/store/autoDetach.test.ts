// Task 7.6: a wording edit on a linked item detaches it first, then applies
// locally (design §4.4 withAutoDetach, Req 7.1, 7.2). Replaces the 6.8 guard.
import { beforeEach, describe, expect, it } from "vitest";
import { useResumeStore } from "./resumeStore";
import { useUiStore } from "./uiStore";
import { makeSeedResume } from "./seed";
import { linkState } from "./resolve";
import type { BankItem, Item, Resume } from "./schema";

const s = () => useResumeStore.getState();
const variantById = (id: string): Resume =>
  s().variants.find((v) => v.id === id)!;
const current = (): Resume => variantById(s().currentVariantId);
const rawItem = (sectionId: string, itemId: string, variant = current()): Item =>
  variant.sections
    .find((x) => x.id === sectionId)!
    .items.find((i) => i.id === itemId)!;
const toasts = () => useUiStore.getState().toasts;

const entry = (): BankItem => s().bank.find((b) => b.id === bankId)!;

let sectionId: string;
let bankId: string;
let linkedId: string;
let otherLinkedId: string;
let otherVariantId: string;

beforeEach(() => {
  useUiStore.setState({ toasts: [] });
  const seed = makeSeedResume("Test");
  const other = makeSeedResume("Other");
  useResumeStore.setState({
    variants: [seed, other],
    currentVariantId: seed.id,
    bank: [],
  });
  otherVariantId = other.id;
  sectionId = seed.sections[0].id;
  bankId = s().addBankItem(seed.sections[0].kind);
  s().updateBankItem(bankId, { heading: "Bank Co", dateRange: "2020" });
  const b1 = entry().bullets[0].id; // a new bank entry starts with one blank bullet
  const b2 = s().addBankBullet(bankId)!;
  const b3 = s().addBankBullet(bankId)!;
  s().updateBankBullet(bankId, b1, "one");
  s().updateBankBullet(bankId, b2, "two");
  s().updateBankBullet(bankId, b3, "three");
  linkedId = s().addItemFromBank(sectionId, bankId)!;
  otherLinkedId = s().addItemFromBank(sectionId, bankId)!;
  // A second variant item linked to the same entry.
  s().setCurrentVariant(other.id);
  s().addItemFromBank(other.sections[0].id, bankId);
  s().setCurrentVariant(seed.id);
  useUiStore.setState({ toasts: [] });
});

const bulletTexts = (i: Item) => i.bullets.map((b) => b.text);

describe("withAutoDetach (task 7.6)", () => {
  it("updateItem(heading) detaches, stores the edit locally and leaves the bank alone", () => {
    const bankBefore = s().bank;
    const bankBullets = entry().bullets.map((b) => ({ ...b }));
    s().updateItem(sectionId, linkedId, { heading: "typed" });
    const item = rawItem(sectionId, linkedId);
    expect(linkState(item)).toBe("detached");
    expect(item.link?.bankId).toBe(bankId);
    expect(item.heading).toBe("typed");
    // Everything else equals the bank wording.
    expect(item.subheading).toBe(entry().subheading);
    expect(item.location).toBe(entry().location);
    expect(item.dateRange).toBe("2020");
    expect(item.bullets).toEqual(bankBullets);
    expect(s().bank).toBe(bankBefore);
    expect(entry().heading).toBe("Bank Co");
  });

  it.each(["subheading", "location", "dateRange"] as const)(
    "updateItem(%s) detaches",
    (key) => {
      s().updateItem(sectionId, linkedId, { [key]: "x" });
      const item = rawItem(sectionId, linkedId);
      expect(linkState(item)).toBe("detached");
      expect(item[key]).toBe("x");
    }
  );

  it("a mixed patch detaches and applies both keys", () => {
    s().updateItem(sectionId, linkedId, { heading: "x", hidden: true });
    const item = rawItem(sectionId, linkedId);
    expect(linkState(item)).toBe("detached");
    expect(item.heading).toBe("x");
    expect(item.hidden).toBe(true);
  });

  it("bakes the overlay: hiddenBulletIds become hidden flags and order is applied", () => {
    const [b1, b2, b3] = entry().bullets.map((b) => b.id);
    s().updateItem(sectionId, linkedId, {
      hiddenBulletIds: [b2],
      bulletOrder: [b3, b1, b2],
    });
    expect(linkState(rawItem(sectionId, linkedId))).toBe("linked");
    s().updateItem(sectionId, linkedId, { heading: "typed" });
    const item = rawItem(sectionId, linkedId);
    expect(item.bullets.map((b) => b.id)).toEqual([b3, b1, b2]);
    expect(item.bullets.find((b) => b.id === b2)?.hidden).toBe(true);
    expect(item.bullets.find((b) => b.id === b1)?.hidden).toBeUndefined();
    expect(item.hiddenBulletIds).toBeUndefined();
    expect(item.bulletOrder).toBeUndefined();
    expect(bulletTexts(item)).toEqual(["three", "one", "two"]);
  });

  it("updateBullet detaches and edits the right bullet, even a hidden one", () => {
    const [b1, b2] = entry().bullets.map((b) => b.id);
    s().updateItem(sectionId, linkedId, { hiddenBulletIds: [b2] });
    s().updateBullet(sectionId, linkedId, b2, "typed");
    const item = rawItem(sectionId, linkedId);
    expect(linkState(item)).toBe("detached");
    expect(item.bullets.find((b) => b.id === b2)).toMatchObject({
      text: "typed",
      hidden: true,
    });
    expect(item.bullets.find((b) => b.id === b1)?.text).toBe("one");
    expect(entry().bullets.find((b) => b.id === b2)?.text).toBe("two");
  });

  it("addBullet detaches, inserts after afterId and returns the new id", () => {
    const [b1, b2, b3] = entry().bullets.map((b) => b.id);
    const id = s().addBullet(sectionId, linkedId, b1);
    expect(id).toBeTruthy();
    const item = rawItem(sectionId, linkedId);
    expect(linkState(item)).toBe("detached");
    expect(item.bullets.map((b) => b.id)).toEqual([b1, id, b2, b3]);
    expect(item.bullets[1].text).toBe("");
    expect(entry().bullets).toHaveLength(3);
  });

  it("addBullet without afterId appends", () => {
    const id = s().addBullet(sectionId, linkedId)!;
    const item = rawItem(sectionId, linkedId);
    expect(item.bullets[item.bullets.length - 1].id).toBe(id);
    expect(item.bullets).toHaveLength(4);
  });

  it("addBullet returns null for a missing item or section", () => {
    const before = s().variants;
    expect(s().addBullet(sectionId, "nope")).toBeNull();
    expect(s().addBullet("nope", linkedId)).toBeNull();
    expect(s().variants).toBe(before);
  });

  it("patches limited to non-wording keys do not detach", () => {
    const b1 = entry().bullets[0].id;
    s().updateItem(sectionId, linkedId, { hidden: true });
    s().updateItem(sectionId, linkedId, { hiddenBulletIds: [b1] });
    s().updateItem(sectionId, linkedId, { bulletOrder: [b1] });
    const item = rawItem(sectionId, linkedId);
    expect(linkState(item)).toBe("linked");
    expect(item.hidden).toBe(true);
    expect(item.hiddenBulletIds).toEqual([b1]);
    expect(item.bulletOrder).toEqual([b1]);
    expect(item.bullets).toEqual([]);
  });

  it("local items just edit", () => {
    const local = current().sections[0].items.find((i) => !i.link)!;
    s().updateItem(sectionId, local.id, { heading: "edited" });
    expect(rawItem(sectionId, local.id).heading).toBe("edited");
    const bulletId = s().addBullet(sectionId, local.id)!;
    s().updateBullet(sectionId, local.id, bulletId, "hello");
    const item = rawItem(sectionId, local.id);
    expect(item.bullets.find((b) => b.id === bulletId)?.text).toBe("hello");
    expect(linkState(item)).toBe("local");
  });

  it("detached items just edit and stay detached", () => {
    s().updateItem(sectionId, linkedId, { heading: "first" });
    const afterFirst = rawItem(sectionId, linkedId);
    s().updateItem(sectionId, linkedId, { heading: "second" });
    const item = rawItem(sectionId, linkedId);
    expect(item.heading).toBe("second");
    expect(item.bullets).toEqual(afterFirst.bullets);
    expect(linkState(item)).toBe("detached");
  });

  it("an orphaned linked item takes the edit locally without detaching", () => {
    useResumeStore.setState({ bank: [] });
    s().updateItem(sectionId, linkedId, { heading: "typed" });
    let item = rawItem(sectionId, linkedId);
    expect(linkState(item)).toBe("linked");
    expect(item.heading).toBe("typed");
    const id = s().addBullet(sectionId, linkedId)!;
    expect(id).toBeTruthy();
    s().updateBullet(sectionId, linkedId, id, "more");
    item = rawItem(sectionId, linkedId);
    expect(linkState(item)).toBe("linked");
    expect(item.bullets).toEqual([{ id, text: "more" }]);
  });

  // Task 7.7: the skills "Items" input reads bullets[0] from the RESOLVED item
  // and routes its edit through the store (ItemEditor skills branch).
  describe("skills Items input flow (task 7.7)", () => {
    it("typing into a linked row with a bank bullet detaches and edits that bullet, no stray bullet", () => {
      const skillsId = s().addBankItem("skills");
      const bankBulletId = "bank-skill-b";
      // Exactly one bank bullet.
      useResumeStore.setState({
        bank: s().bank.map((b) =>
          b.id === skillsId ? { ...b, bullets: [{ id: bankBulletId, text: "TS" }] } : b
        ),
      });
      const id = s().addItemFromBank(sectionId, skillsId)!;
      expect(rawItem(sectionId, id).bullets).toEqual([]); // raw storage is empty

      s().updateBullet(sectionId, id, bankBulletId, "TS, Go");

      const item = rawItem(sectionId, id);
      expect(linkState(item)).toBe("detached");
      expect(item.bullets).toEqual([{ id: bankBulletId, text: "TS, Go" }]);
      expect(s().bank.find((b) => b.id === skillsId)!.bullets[0].text).toBe("TS");
    });

    it("a linked row whose bank entry has no bullets: addBullet then updateBullet yields one bullet with the text", () => {
      const skillsId = s().addBankItem("skills");
      useResumeStore.setState({
        bank: s().bank.map((b) => (b.id === skillsId ? { ...b, bullets: [] } : b)),
      });
      const id = s().addItemFromBank(sectionId, skillsId)!;

      const bulletId = s().addBullet(sectionId, id);
      expect(bulletId).toBeTruthy();
      s().updateBullet(sectionId, id, bulletId!, "T");

      const item = rawItem(sectionId, id);
      expect(item.bullets).toEqual([{ id: bulletId, text: "T" }]);
      expect(linkState(item)).toBe("detached");
    });
  });

  it("pushes no toast", () => {
    const b1 = entry().bullets[0].id;
    s().updateItem(sectionId, linkedId, { heading: "x" });
    s().updateBullet(sectionId, linkedId, b1, "y");
    s().addBullet(sectionId, linkedId);
    expect(toasts()).toHaveLength(0);
  });

  it("leaves other items and other variants untouched", () => {
    const otherBefore = rawItem(sectionId, otherLinkedId);
    const variantBefore = variantById(otherVariantId);
    s().updateItem(sectionId, linkedId, { heading: "typed" });
    expect(rawItem(sectionId, otherLinkedId)).toBe(otherBefore);
    expect(variantById(otherVariantId)).toBe(variantBefore);
    expect(linkState(rawItem(sectionId, otherLinkedId))).toBe("linked");
  });

  it("does not detach on toggleItemHidden or reorderItems", () => {
    s().toggleItemHidden(sectionId, linkedId);
    s().reorderItems(
      sectionId,
      current().sections[0].items.map((i) => i.id).reverse()
    );
    expect(linkState(rawItem(sectionId, linkedId))).toBe("linked");
  });
});
