// Task 9.2: which bank an import is reconciled against, and what happens to the
// store's bank afterwards (design §4.7, §6; Req 10.2, 10.3).
//
//   library import  -> reconciled against the bank IN THE FILE; the store's
//                      bank is replaced by it together with the variants.
//   single-variant  -> reconciled against the store's CURRENT bank; the
//                      store's bank is left alone.
//
// Deliberately independent of `contentEquals` / `reconcileImportedItem`
// (9.3/9.4): the reconciliation seam is observed through an injected
// reconciler, so these tests keep holding once 9.5 plugs the real one in.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useResumeStore } from "../store/resumeStore";
import { makeSeedResume } from "../store/seed";
import type { BankItem, Resume } from "../store/schema";
import { libraryJsonPayload, parseImport, resumeJsonPayload } from "./importExport";
import type { VariantReconciler } from "./importExport";

const entry = (id: string, heading: string): BankItem => ({
  id,
  kind: "experience",
  heading,
  subheading: "Engineer",
  bullets: [{ id: `${id}_b1`, text: `${heading} bullet` }],
  updatedAt: "2025-01-01T00:00:00.000Z",
});

const importedBank = [entry("bk_file_1", "From the file"), entry("bk_file_2", "Also the file")];
const storeBank = [entry("bk_store_1", "Already in the store")];

const linkedVariant = (name: string, bankId: string): Resume => {
  const v = makeSeedResume(name);
  v.sections[0].items = [{ id: `i_${name}`, link: { bankId }, bullets: [] }];
  return v;
};

const s = () => useResumeStore.getState();
const idsOf = (m: Map<string, BankItem>) => [...m.keys()];

let initial: ReturnType<typeof s>;

beforeEach(() => {
  initial = s();
  useResumeStore.setState({
    variants: [makeSeedResume("Store A"), makeSeedResume("Store B")],
    bank: storeBank,
  });
  s().setCurrentVariant(s().variants[0].id);
});

afterEach(() => {
  vi.restoreAllMocks();
  useResumeStore.setState({
    variants: initial.variants,
    bank: initial.bank,
    currentVariantId: initial.currentVariantId,
  });
});

describe("library import carries the imported bank with the variants", () => {
  const variants = [linkedVariant("V1", "bk_file_1"), linkedVariant("V2", "bk_file_2")];

  it("returns the file's bank next to the variants, not the store's", () => {
    const parsed = parseImport(libraryJsonPayload(variants, importedBank));
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);

    expect(parsed.bank).toEqual(importedBank);
    expect(parsed.variants.map((v) => v.id)).toEqual(variants.map((v) => v.id));
    expect(parsed.bank).not.toEqual(s().bank);
  });

  it("a library file with no bank key yields [] even when the store has a bank", () => {
    expect(s().bank.length).toBeGreaterThan(0);
    const raw = JSON.stringify({ schemaVersion: 3, variants });

    const parsed = parseImport(raw);
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);

    expect(parsed.bank).toEqual([]);
  });

  it("never consults the store's bank: no getCurrentBank call, no store read", () => {
    const getCurrentBank = vi.fn((): BankItem[] => {
      throw new Error("library import must not read the current bank");
    });
    const getState = vi.spyOn(useResumeStore, "getState");

    const parsed = parseImport(libraryJsonPayload(variants, importedBank), { getCurrentBank });

    expect(parsed.kind).toBe("library");
    expect(getCurrentBank).not.toHaveBeenCalled();
    expect(getState).not.toHaveBeenCalled();
  });

  it("the result does not depend on what the store's bank holds", () => {
    const raw = libraryJsonPayload(variants, importedBank);
    const withStoreBank = parseImport(raw, { getCurrentBank: () => s().bank });
    useResumeStore.setState({ bank: [] });
    const withEmptyStoreBank = parseImport(raw, { getCurrentBank: () => s().bank });

    expect(withEmptyStoreBank).toEqual(withStoreBank);
  });

  it("reconciles every variant, in order, against exactly the imported bank", () => {
    const seen: { id: string; bankIds: string[] }[] = [];
    const reconcileVariant: VariantReconciler = (v, bankById) => {
      seen.push({ id: v.id, bankIds: idsOf(bankById) });
      return { variant: v, diverged: 0 };
    };

    parseImport(libraryJsonPayload(variants, importedBank), { reconcileVariant });

    expect(seen).toEqual(
      variants.map((v) => ({ id: v.id, bankIds: ["bk_file_1", "bk_file_2"] }))
    );
  });

  it("a bank-less library file reconciles against an empty map, not the store's bank", () => {
    const bankIds: string[][] = [];
    const reconcileVariant: VariantReconciler = (v, bankById) => {
      bankIds.push(idsOf(bankById));
      return { variant: v, diverged: 0 };
    };

    parseImport(JSON.stringify({ schemaVersion: 3, variants }), {
      getCurrentBank: () => s().bank,
      reconcileVariant,
    });

    expect(s().bank.length).toBeGreaterThan(0);
    expect(bankIds).toEqual([[], []]);
  });

  it("returns what the reconciler returned, and still returns the imported bank unchanged", () => {
    const reconcileVariant: VariantReconciler = (v) => ({
      variant: { ...v, name: `${v.name}*` },
      diverged: 0,
    });

    const parsed = parseImport(libraryJsonPayload(variants, importedBank), { reconcileVariant });
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);

    expect(parsed.variants.map((v) => v.name)).toEqual(["V1*", "V2*"]);
    expect(parsed.bank).toEqual(importedBank);
  });

  it("variants given an id are reconciled under that id", () => {
    const noId = { ...variants[0], id: "" };
    const seen: string[] = [];
    const reconcileVariant: VariantReconciler = (v) => {
      seen.push(v.id);
      return { variant: v, diverged: 0 };
    };

    parseImport(JSON.stringify({ schemaVersion: 3, variants: [noId], bank: importedBank }), {
      reconcileVariant,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBe("");
  });

  it("replaceLibrary(variants, bank) swaps in the imported bank and drops the old one", () => {
    const parsed = parseImport(libraryJsonPayload(variants, importedBank));
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);

    s().replaceLibrary(parsed.variants, parsed.bank);

    expect(s().bank).toEqual(importedBank);
    expect(s().variants.map((v) => v.id)).toEqual(variants.map((v) => v.id));
    expect(s().currentVariantId).toBe(variants[0].id);
  });

  it("restoring a bank-less library clears the store's bank rather than keeping it", () => {
    const parsed = parseImport(JSON.stringify({ schemaVersion: 3, variants }));
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);

    s().replaceLibrary(parsed.variants, parsed.bank);

    expect(s().bank).toEqual([]);
  });
});

describe("single-variant import reconciles against the store's bank and leaves it alone", () => {
  const variant = linkedVariant("Solo", "bk_store_1");
  const raw = () => resumeJsonPayload(variant, storeBank);

  it("reconciles against the current bank, read once through the thunk", () => {
    const getCurrentBank = vi.fn(() => s().bank);
    const bankIds: string[][] = [];
    const reconcileVariant: VariantReconciler = (v, bankById) => {
      bankIds.push(idsOf(bankById));
      return { variant: v, diverged: 0 };
    };

    const parsed = parseImport(raw(), { getCurrentBank, reconcileVariant });

    expect(parsed.kind).toBe("resume");
    expect(getCurrentBank).toHaveBeenCalledTimes(1);
    expect(bankIds).toEqual([["bk_store_1"]]);
  });

  it("reads the bank at parse time, not when the options were built", () => {
    const getCurrentBank = () => s().bank;
    const options = { getCurrentBank, reconcileVariant: vi.fn<VariantReconciler>((v) => ({ variant: v, diverged: 0 })) };
    useResumeStore.setState({ bank: importedBank });

    parseImport(raw(), options);

    const [, bankById] = options.reconcileVariant.mock.calls[0];
    expect(idsOf(bankById)).toEqual(["bk_file_1", "bk_file_2"]);
  });

  it("with no getCurrentBank it reconciles against an empty bank", () => {
    const bankIds: string[][] = [];
    const reconcileVariant: VariantReconciler = (v, bankById) => {
      bankIds.push(idsOf(bankById));
      return { variant: v, diverged: 0 };
    };

    parseImport(raw(), { reconcileVariant });

    expect(bankIds).toEqual([[]]);
  });

  it("the parsed resume carries no bank, so it cannot replace the store's", () => {
    const parsed = parseImport(raw(), { getCurrentBank: () => s().bank });
    if (parsed.kind !== "resume") throw new Error(`expected resume, got ${parsed.kind}`);

    expect("bank" in parsed).toBe(false);
    // @ts-expect-error the resume branch of ParsedImport has no `bank`
    void parsed.bank;
  });

  it("replaceVariant and addVariant leave the store's bank untouched", () => {
    const parsed = parseImport(raw(), { getCurrentBank: () => s().bank });
    if (parsed.kind !== "resume") throw new Error(`expected resume, got ${parsed.kind}`);
    const before = s().bank;

    s().replaceVariant(s().currentVariantId, parsed.resume);
    expect(s().bank).toBe(before);

    s().addVariant(parsed.resume);
    expect(s().bank).toBe(before);
    expect(s().bank).toEqual(storeBank);
  });
});

describe("replaceLibrary is all-or-nothing", () => {
  it("an empty variant list changes neither the variants nor the bank", () => {
    const before = { variants: s().variants, bank: s().bank, current: s().currentVariantId };

    s().replaceLibrary([], importedBank);

    expect(s().variants).toBe(before.variants);
    expect(s().bank).toBe(before.bank);
    expect(s().currentVariantId).toBe(before.current);
  });
});
