// Task 8.3: delete/duplicate routing for bullets + the hide/unhide flow the
// editor UI relies on (design §4.3, Req 7.2, 8.1, 8.4).
import { beforeEach, describe, expect, it } from "vitest";
import { bulletRowActions } from "./bulletRowActions";
import { overlayHiddenBullets, resolveItem } from "./resolve";
import { useResumeStore } from "./resumeStore";
import { makeSeedResume } from "./seed";
import type { BankItem, Item } from "./schema";

const entry: BankItem = {
  id: "bank1",
  kind: "experience",
  heading: "Bank Co",
  bullets: [
    { id: "b1", text: "one" },
    { id: "b2", text: "two" },
    { id: "b3", text: "three" },
    { id: "b4", text: "four" },
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const linked: Item = { id: "linked", link: { bankId: "bank1" }, bullets: [] };
const detached: Item = {
  id: "detached",
  link: { bankId: "bank1", detached: true },
  bullets: [{ id: "d1", text: "d" }],
};
const local: Item = { id: "local", bullets: [{ id: "l1", text: "l" }] };
const orphan: Item = {
  id: "orphan",
  link: { bankId: "gone" },
  bullets: [{ id: "o1", text: "o" }],
};

describe("bulletRowActions", () => {
  it("linked with entry: hide instead of delete, no duplicate", () => {
    expect(bulletRowActions(linked, entry)).toEqual({
      linked: true,
      deleteMode: "hide",
      canDuplicate: false,
    });
  });

  it.each([
    ["local", local, undefined],
    ["local (entry irrelevant)", local, entry],
    ["detached", detached, entry],
    ["orphan", orphan, undefined],
    ["linked but entry missing", linked, undefined],
    ["missing item", undefined, entry],
  ] as const)("%s: real delete and duplicate", (_name, item, e) => {
    expect(bulletRowActions(item, e)).toEqual({
      linked: false,
      deleteMode: "delete",
      canDuplicate: true,
    });
  });
});

describe("hide / unhide flow on a linked item", () => {
  const s = () => useResumeStore.getState();
  let vId: string;
  let sectionId: string;

  const rawItem = (id: string): Item =>
    s()
      .variants.find((v) => v.id === vId)!
      .sections.find((x) => x.id === sectionId)!
      .items.find((i) => i.id === id)!;
  const resolvedIds = () =>
    resolveItem(rawItem("linked"), new Map(s().bank.map((b) => [b.id, b]))).bullets.map(
      (b) => b.id
    );

  beforeEach(() => {
    const v = makeSeedResume("V");
    vId = v.id;
    sectionId = v.sections[0].id;
    v.sections[0].items = [
      { ...linked },
      { ...detached },
      { ...local },
      { ...orphan },
    ];
    useResumeStore.setState({
      variants: [v],
      currentVariantId: v.id,
      bank: [structuredClone(entry)],
    });
  });

  it("hide a shown bullet -> listed for un-hiding -> unhide restores its entry-order slot", () => {
    s().toggleBulletHidden(sectionId, "linked", "b2");
    expect(resolvedIds()).toEqual(["b1", "b3", "b4"]);
    expect(
      overlayHiddenBullets(rawItem("linked"), s().bank[0]).map((b) => b.id)
    ).toEqual(["b2"]);

    s().toggleBulletHidden(sectionId, "linked", "b2");
    expect(overlayHiddenBullets(rawItem("linked"), s().bank[0])).toEqual([]);
    expect(resolvedIds()).toEqual(["b1", "b2", "b3", "b4"]);
    expect("hiddenBulletIds" in rawItem("linked")).toBe(false);
  });

  it("unhide after a reorder: the bullet appends (unknown ids append)", () => {
    s().toggleBulletHidden(sectionId, "linked", "b2");
    // The editor passes only the ids it shows.
    s().reorderBullets(sectionId, "linked", ["b4", "b3", "b1"]);
    s().toggleBulletHidden(sectionId, "linked", "b2");
    expect(resolvedIds()).toEqual(["b4", "b3", "b1", "b2"]);
  });

  it("hiding never detaches or touches the bank", () => {
    const bank = s().bank;
    s().toggleBulletHidden(sectionId, "linked", "b1");
    expect(rawItem("linked").link?.detached).toBeFalsy();
    expect(rawItem("linked").bullets).toEqual([]);
    expect(s().bank).toBe(bank);
  });

  it("delete-mode per link state matches what the store can actually do", () => {
    const bank = s().bank[0];
    // linked: the store cannot delete a bank bullet (raw bullets are empty),
    // which is why the UI routes ✕ to hide.
    expect(bulletRowActions(rawItem("linked"), bank).deleteMode).toBe("hide");
    expect(s().deleteBullet(sectionId, "linked", "b1")).toBeNull();

    // local / detached / orphan: real delete returns the removed bullet.
    for (const [id, bulletId] of [
      ["local", "l1"],
      ["detached", "d1"],
      ["orphan", "o1"],
    ] as const) {
      const e = id === "detached" ? bank : undefined;
      expect(bulletRowActions(rawItem(id), e).deleteMode).toBe("delete");
      expect(s().deleteBullet(sectionId, id, bulletId)?.id).toBe(bulletId);
    }
  });
});
