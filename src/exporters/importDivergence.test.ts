// Task 9.5: run reconciliation across every imported variant in `parseImport`,
// roll the divergence count up, and surface it as a review toast.
//
// This exercises the REAL reconciler (`reconcileVariant` from store/reconcile),
// not an injected pass-through, so it is the end-to-end counterpart of
// importBankPlumbing.test.ts (which pins the seam with a fake). The per-item
// decisions are covered in store/reconcileImportedItem.test.ts and
// exporters/reconcileImportedItem.exportPath.test.ts; here we assert the
// roll-up across sections and across variants, the zero-count no-op round trip,
// library counting against the imported bank, and the toast message helper.
//
// **Validates: Requirements 10.3, 10.4, 10.5**
import { describe, expect, it } from "vitest";
import {
  divergenceMessage,
  reconcileVariant,
  withDivergence,
} from "../store/reconcile";
import { CURRENT_SCHEMA_VERSION } from "../store/schema";
import type { BankItem, Item, Resume } from "../store/schema";
import { libraryJsonPayload, parseImport, resumeJsonPayload } from "./importExport";

const entry = (id: string, heading: string): BankItem => ({
  id,
  kind: "experience",
  heading,
  subheading: "Engineer",
  location: "Remote",
  dateRange: "2020 - 2022",
  bullets: [
    { id: `${id}_b1`, text: "one" },
    { id: `${id}_b2`, text: "two" },
    { id: `${id}_b3`, text: "three" },
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
});

const bank = [entry("bank1", "Alpha Co"), entry("bank2", "Beta Co"), entry("bank3", "Gamma Co")];
const bankById = new Map(bank.map((b) => [b.id, b]));

/** A raw linked item: no wording, as a library file stores it. */
const linked = (id: string, bankId: string): Item => ({ id, bullets: [], link: { bankId } });

const variant = (name: string, sections: Resume["sections"]): Resume => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: `r_${name}`,
  name,
  updatedAt: "2024-01-01T00:00:00.000Z",
  header: { fullName: "N", fields: [] },
  sections,
});

const section = (id: string, items: Item[]): Resume["sections"][number] => ({
  id,
  kind: "experience",
  title: "Experience",
  items,
});

describe("reconcileVariant: rolls the count up across sections", () => {
  it("sums diverged items from every section of the variant", () => {
    // Inlined (single-variant export shape) items that have been edited diverge;
    // raw/linked and local items do not.
    const inlinedEdited = (id: string, bankId: string, heading: string): Item => ({
      id,
      heading, // differs from the bank entry's heading -> diverged
      subheading: "Engineer",
      location: "Remote",
      dateRange: "2020 - 2022",
      bullets: bankById.get(bankId)!.bullets.map((b) => ({ ...b })),
      link: { bankId },
    });

    const v = variant("multi", [
      section("s1", [
        inlinedEdited("a", "bank1", "Alpha Co, Staff"), // diverged
        linked("b", "bank2"), // raw, not diverged
      ]),
      section("s2", [
        inlinedEdited("c", "bank3", "Gamma Co, Lead"), // diverged
        { id: "d", heading: "Local", bullets: [{ id: "d1", text: "mine" }] }, // local, not diverged
      ]),
    ]);

    const r = reconcileVariant(v, bankById);
    expect(r.diverged).toBe(2);
  });

  it("a variant with no links anywhere is unchanged and counts zero", () => {
    const v = variant("plain", [
      section("s1", [{ id: "x", heading: "A", bullets: [{ id: "x1", text: "one" }] }]),
    ]);
    const r = reconcileVariant(v, bankById);
    expect(r.diverged).toBe(0);
    // structural sharing is not promised, but the content must be equal
    expect(r.variant).toEqual(v);
  });

  it("does not mutate the input variant", () => {
    const v = variant("frozen", [section("s1", [linked("a", "bank1")])]);
    const before = JSON.stringify(v);
    reconcileVariant(v, bankById);
    expect(JSON.stringify(v)).toBe(before);
  });
});

describe("parseImport rolls the count up across every variant (library)", () => {
  // Build an inlined, edited linked item so the real reconciler counts it as
  // diverged. A library file carries RAW linked items, so to produce a
  // divergence we hand the file inlined wording that differs from the bank.
  const edited = (id: string, bankId: string, heading: string): Item => ({
    id,
    heading,
    subheading: "Engineer",
    location: "Remote",
    dateRange: "2020 - 2022",
    bullets: bankById.get(bankId)!.bullets.map((b) => ({ ...b })),
    link: { bankId },
  });

  it("totals divergences from all variants against the imported bank", () => {
    const v1 = variant("V1", [section("s1", [edited("a", "bank1", "Alpha Co, Staff")])]); // 1
    const v2 = variant("V2", [
      section("s1", [
        edited("b", "bank2", "Beta Co, Lead"), // 1
        edited("c", "bank3", "Gamma Co, Principal"), // 1
      ]),
    ]);

    const parsed = parseImport(libraryJsonPayload([v1, v2], bank));
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);
    expect(parsed.diverged).toBe(3);
  });

  it("counts against the IMPORTED bank, not the store's bank", () => {
    // The file's bank is `bank`. The imported variant carries the bank's exact
    // resolved wording, so against the imported bank nothing diverges even when
    // a (hostile) store bank is supplied via getCurrentBank.
    const v1 = variant("V1", [section("s1", [edited("a", "bank1", "Alpha Co")])]); // == bank
    const differentStoreBank = [entry("bank1", "A COMPLETELY DIFFERENT HEADING")];

    const parsed = parseImport(libraryJsonPayload([v1], bank), {
      getCurrentBank: () => differentStoreBank,
    });
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);
    // Zero: the item matches the file's bank; the store's bank is never consulted.
    expect(parsed.diverged).toBe(0);
  });

  it("a raw library file (no inlined wording) never diverges", () => {
    const v1 = variant("V1", [section("s1", [linked("a", "bank1"), linked("b", "bank2")])]);
    const parsed = parseImport(libraryJsonPayload([v1], bank));
    if (parsed.kind !== "library") throw new Error(`expected library, got ${parsed.kind}`);
    expect(parsed.diverged).toBe(0);
  });
});

describe("parseImport divergence (single variant, zero on a no-op round trip)", () => {
  // The overlay no-op case from the demo: hide a bullet on a linked item,
  // export, re-import with no edits -> count 0, item still linked.
  const rawVariant = variant("Solo", [
    section("s1", [
      { id: "i_overlay", bullets: [], link: { bankId: "bank1" }, hiddenBulletIds: ["bank1_b2"] },
    ]),
  ]);

  it("hide a bullet, export, re-import unchanged => diverged is 0", () => {
    const json = resumeJsonPayload(rawVariant, bank);
    const parsed = parseImport(json, { getCurrentBank: () => bank });
    if (parsed.kind !== "resume") throw new Error(`expected resume, got ${parsed.kind}`);

    expect(parsed.diverged).toBe(0);
    const item = parsed.resume.sections[0].items[0];
    expect(item.link).toEqual({ bankId: "bank1" }); // still linked
    expect(item.hiddenBulletIds).toEqual(["bank1_b2"]); // overlay preserved
  });

  it("editing one bullet of that same item before re-import => diverged is 1", () => {
    const json = JSON.parse(resumeJsonPayload(rawVariant, bank)) as Resume;
    const item = json.sections[0].items[0];
    item.bullets = item.bullets.map((b) =>
      b.id === "bank1_b1" ? { ...b, text: "one (reworded by Claude)" } : b
    );

    const parsed = parseImport(JSON.stringify(json), { getCurrentBank: () => bank });
    if (parsed.kind !== "resume") throw new Error(`expected resume, got ${parsed.kind}`);
    expect(parsed.diverged).toBe(1);
    expect(parsed.resume.sections[0].items[0].link).toEqual({
      bankId: "bank1",
      detached: true,
    });
  });
});

describe("divergenceMessage: singular/plural and the zero/invalid guard", () => {
  it("returns null for zero and anything non-positive or non-finite", () => {
    expect(divergenceMessage(0)).toBeNull();
    expect(divergenceMessage(-3)).toBeNull();
    expect(divergenceMessage(NaN)).toBeNull();
    expect(divergenceMessage(Infinity)).toBeNull();
  });

  it("is singular for exactly one", () => {
    expect(divergenceMessage(1)).toBe("1 item diverged from the bank — review");
  });

  it("is plural for more than one", () => {
    expect(divergenceMessage(2)).toBe("2 items diverged from the bank — review");
    expect(divergenceMessage(7)).toBe("7 items diverged from the bank — review");
  });

  it("floors a fractional count", () => {
    expect(divergenceMessage(2.9)).toBe("2 items diverged from the bank — review");
  });
});

describe("withDivergence: combines with the import toast", () => {
  it("leaves the base message alone when nothing diverged", () => {
    expect(withDivergence("Imported 3 variants", 0)).toBe("Imported 3 variants");
  });

  it("appends the review message when something diverged", () => {
    expect(withDivergence("Imported 3 variants", 7)).toBe(
      "Imported 3 variants. 7 items diverged from the bank — review"
    );
  });

  it("uses the singular form for one", () => {
    expect(withDivergence('Overwrote "Master"', 1)).toBe(
      'Overwrote "Master". 1 item diverged from the bank — review'
    );
  });
});
