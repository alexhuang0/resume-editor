import { beforeEach, describe, expect, it } from "vitest";
import { useResumeStore } from "./resumeStore";

const s = () => useResumeStore.getState();

beforeEach(() => {
  useResumeStore.setState({ bank: [] });
});

describe("bank CRUD (5.4)", () => {
  it("addBankItem creates a blank item with one blank bullet, for every kind", () => {
    for (const kind of ["experience", "skills", "custom"] as const) {
      const id = s().addBankItem(kind);
      const item = s().bank.find((b) => b.id === id)!;
      expect(item.id.startsWith("bk")).toBe(true);
      expect(item.kind).toBe(kind);
      expect(item.heading).toBe("");
      expect(item.subheading).toBe("");
      expect(item.location).toBe("");
      expect(item.dateRange).toBe("");
      expect(item.bullets).toHaveLength(1);
      expect(item.bullets[0].text).toBe("");
    }
    expect(s().bank).toHaveLength(3);
  });

  it("updateBankItem patches fields and bumps updatedAt, leaving id/kind/bullets alone", () => {
    const id = s().addBankItem("experience");
    useResumeStore.setState({
      bank: s().bank.map((b) => ({ ...b, updatedAt: "2000-01-01T00:00:00.000Z" })),
    });
    const before = s().bank[0];
    s().updateBankItem(id, { heading: "Acme", dateRange: "2020" });
    const after = s().bank[0];
    expect(after.heading).toBe("Acme");
    expect(after.dateRange).toBe("2020");
    expect(after.id).toBe(before.id);
    expect(after.kind).toBe(before.kind);
    expect(after.bullets).toEqual(before.bullets);
    expect(after.updatedAt).not.toBe(before.updatedAt);
  });

  it("renameBankItemLabel sets a label and clears it when blank", () => {
    const id = s().addBankItem("projects");
    s().renameBankItemLabel(id, "My project");
    expect(s().bank[0].label).toBe("My project");
    s().renameBankItemLabel(id, "   ");
    expect(s().bank[0].label).toBeUndefined();
  });

  it("deleteBankItem returns the removed item, and null for an unknown id", () => {
    const id = s().addBankItem("education");
    const removed = s().deleteBankItem(id);
    expect(removed?.id).toBe(id);
    expect(s().bank).toHaveLength(0);
    expect(s().deleteBankItem("nope")).toBeNull();
  });

  it("duplicateBankItem regenerates every id, appends ' copy' to a label, and sits after the source", () => {
    const id = s().addBankItem("experience");
    s().addBankItem("skills");
    s().renameBankItemLabel(id, "Acme");
    s().updateBankItem(id, { heading: "Acme Inc" });
    s().addBankBullet(id);
    const copyId = s().duplicateBankItem(id)!;
    const [source, copy] = [s().bank[0], s().bank[1]];
    expect(copy.id).toBe(copyId);
    expect(copyId).not.toBe(id);
    expect(copy.label).toBe("Acme copy");
    expect(copy.heading).toBe("Acme Inc");
    expect(copy.bullets).toHaveLength(2);
    const sourceIds = new Set(source.bullets.map((b) => b.id));
    expect(copy.bullets.some((b) => sourceIds.has(b.id))).toBe(false);
    expect(s().bank).toHaveLength(3);
    expect(s().duplicateBankItem("nope")).toBeNull();
  });

  it("duplicateBankItem leaves an unset label unset", () => {
    const id = s().addBankItem("custom");
    s().duplicateBankItem(id);
    expect(s().bank[1].label).toBeUndefined();
  });

  it("bullet actions add, update, reorder and delete", () => {
    const id = s().addBankItem("experience");
    const first = s().bank[0].bullets[0].id;
    const second = s().addBankBullet(id, first)!;
    s().updateBankBullet(id, second, "hello");
    expect(s().bank[0].bullets.map((b) => b.text)).toEqual(["", "hello"]);

    s().reorderBankBullets(id, [second, first]);
    expect(s().bank[0].bullets.map((b) => b.id)).toEqual([second, first]);

    const removed = s().deleteBankBullet(id, second);
    expect(removed?.text).toBe("hello");
    expect(s().bank[0].bullets.map((b) => b.id)).toEqual([first]);
    expect(s().deleteBankBullet(id, "nope")).toBeNull();
    expect(s().addBankBullet("nope")).toBeNull();
  });

  it("bank mutations never touch variants", () => {
    const variantsBefore = s().variants;
    const id = s().addBankItem("experience");
    s().updateBankItem(id, { heading: "X" });
    s().addBankBullet(id);
    s().duplicateBankItem(id);
    s().deleteBankItem(id);
    expect(s().variants).toBe(variantsBefore);
  });
});
