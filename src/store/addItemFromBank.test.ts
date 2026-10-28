import { beforeEach, describe, expect, it } from "vitest";
import { useResumeStore } from "./resumeStore";
import { resolveResume } from "./resolve";
import { makeSeedResume } from "./seed";
import type { Resume } from "./schema";

const s = () => useResumeStore.getState();
const current = (): Resume =>
  s().variants.find((v) => v.id === s().currentVariantId)!;

let sectionId: string;
let bankId: string;

beforeEach(() => {
  const seed = makeSeedResume("Test");
  useResumeStore.setState({
    variants: [seed],
    currentVariantId: seed.id,
    bank: [],
  });
  sectionId = seed.sections[0].id;
  bankId = s().addBankItem(seed.sections[0].kind);
  s().updateBankItem(bankId, { heading: "Bank Heading", dateRange: "2021" });
  s().updateBankBullet(bankId, s().bank[0].bullets[0].id, "Bank bullet");
});

describe("addItemFromBank (5.4, 6.1, 9.3)", () => {
  it("appends a minimal linked item at the end", () => {
    const before = current().sections[0].items;
    const id = s().addItemFromBank(sectionId, bankId)!;
    const items = current().sections[0].items;
    expect(items).toHaveLength(before.length + 1);
    expect(items[items.length - 1].id).toBe(id);
    expect(id.startsWith("i")).toBe(true);
  });

  it("inserts after afterId when given", () => {
    const first = current().sections[0].items[0].id;
    const id = s().addItemFromBank(sectionId, bankId, first)!;
    const items = current().sections[0].items;
    expect(items[0].id).toBe(first);
    expect(items[1].id).toBe(id);
  });

  it("appends when afterId is not found", () => {
    const id = s().addItemFromBank(sectionId, bankId, "missing")!;
    const items = current().sections[0].items;
    expect(items[items.length - 1].id).toBe(id);
  });

  it("stores a link with no wording and empty bullets", () => {
    const id = s().addItemFromBank(sectionId, bankId)!;
    const item = current().sections[0].items.find((i) => i.id === id)!;
    expect(item.link).toEqual({ bankId });
    expect(item.bullets).toEqual([]);
    expect(item.heading).toBeUndefined();
    expect(item.subheading).toBeUndefined();
    expect(item.location).toBeUndefined();
    expect(item.dateRange).toBeUndefined();
  });

  it("returns null and changes nothing for an unknown section or bank id", () => {
    const variantsBefore = s().variants;
    expect(s().addItemFromBank("nope", bankId)).toBeNull();
    expect(s().addItemFromBank(sectionId, "nope")).toBeNull();
    expect(s().variants).toBe(variantsBefore);
  });

  it("leaves the bank unchanged", () => {
    const bankBefore = s().bank;
    const snapshot = structuredClone(bankBefore);
    s().addItemFromBank(sectionId, bankId);
    expect(s().bank).toBe(bankBefore);
    expect(s().bank).toEqual(snapshot);
  });

  it("only touches the current variant", () => {
    const other = makeSeedResume("Other");
    useResumeStore.setState({ variants: [...s().variants, other] });
    s().addItemFromBank(sectionId, bankId);
    expect(s().variants.find((v) => v.id === other.id)).toBe(other);
  });

  it("resolves to the bank wording", () => {
    const id = s().addItemFromBank(sectionId, bankId)!;
    const resolved = resolveResume(current(), s().bank);
    const item = resolved.sections[0].items.find((i) => i.id === id)!;
    expect(item.heading).toBe("Bank Heading");
    expect(item.dateRange).toBe("2021");
    expect(item.bullets.map((b) => b.text)).toEqual(["Bank bullet"]);
  });
});
