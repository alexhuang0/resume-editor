import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildPayload,
  mergeLibraries,
  isCloudNewer,
  PAYLOAD_VERSION,
  type LibraryPayload,
} from "./syncEngine";
import { ResumeSchema, BankItemSchema } from "../store/schema";
import type { BankItem, Resume } from "../store/schema";

/**
 * Property tests for the pure sync-engine core (spec oauth-authentication,
 * design §"Correctness Properties"). No network, no DOM, no fakes — these pin
 * the merge/version invariants the controller depends on.
 *
 * Arbitraries build MINIMAL valid Resume / BankItem objects (satisfying the
 * zod schemas in src/store/schema.ts) carrying ARBITRARY ids, which is all the
 * id-set / shape / timestamp properties here need.
 */

const NUM_RUNS = 100;

/** JSON round trip: plain prototypes, no `undefined` keys, so shape assertions
 * never trip on prototype or key artifacts. */
function plain<T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T> {
  return arb.map((v) => JSON.parse(JSON.stringify(v)) as T);
}

/** A minimal valid v3 Resume with the given id. Only the schema-required shape
 * is populated; content is empty because these properties care about ids. */
function resumeWithId(id: string): Resume {
  return {
    schemaVersion: 3,
    id,
    name: "",
    updatedAt: "",
    header: { fullName: "", fields: [] },
    sections: [],
  };
}

/** A minimal valid BankItem with the given id. */
function bankItemWithId(id: string): BankItem {
  return {
    id,
    kind: "experience",
    bullets: [],
    updatedAt: "",
  };
}

/** Ids drawn from a small alphabet so collisions between the two input lists
 * happen routinely (the interesting case for union / cloud-wins / duplicates). */
const arbId = fc.integer({ min: 0, max: 8 }).map((n) => `id-${n}`);

/** A list of minimal resumes with UNIQUE ids (as any single library side is). */
const arbVariants: fc.Arbitrary<Resume[]> = fc
  .uniqueArray(arbId, { maxLength: 6 })
  .map((ids) => ids.map(resumeWithId));

/** A list of minimal bank items with UNIQUE ids. */
const arbBank: fc.Arbitrary<BankItem[]> = fc
  .uniqueArray(arbId, { maxLength: 6 })
  .map((ids) => ids.map(bankItemWithId));

/** A slice (variants + currentVariantId + bank). `currentVariantId` is one of
 * the variant ids when any exist, else an arbitrary id. */
const arbSlice = plain(
  arbVariants.chain((variants) =>
    arbBank.chain((bank) =>
      (variants.length > 0
        ? fc.constantFrom(...variants.map((v) => v.id))
        : arbId
      ).map((currentVariantId) => ({ variants, currentVariantId, bank }))
    )
  )
);

/** A cloud LibraryPayload (slice shape + payloadVersion). */
const arbPayload: fc.Arbitrary<LibraryPayload> = arbSlice.map((slice) => ({
  variants: slice.variants,
  currentVariantId: slice.currentVariantId,
  bank: slice.bank,
  payloadVersion: PAYLOAD_VERSION,
}));

/** A (cloud, local) pair, independently generated. */
const arbCloudAndLocal = fc.record({ cloud: arbPayload, local: arbSlice });

const ids = (xs: { id: string }[]): Set<string> => new Set(xs.map((x) => x.id));
const union = (a: Set<string>, b: Set<string>): Set<string> => new Set([...a, ...b]);

describe("Feature: oauth-authentication, Property 1: Payload shape is closed", () => {
  // The UI-store keys that must never leak into the cloud payload (design §
  // Property 1).
  const UI_KEYS = [
    "collapsedSections",
    "collapsedItems",
    "paneOrder",
    "minimizedPanes",
    "paneWidths",
    "previewZoom",
    "pageFit",
    "sidebarMode",
    "focus",
    "toasts",
  ];

  it("buildPayload output has exactly the four payload keys and no uiStore key", () => {
    fc.assert(
      fc.property(
        // A slice that also carries stray uiStore keys, to prove buildPayload
        // copies only the four payload keys and drops everything else.
        arbSlice.map((slice) => ({
          ...slice,
          collapsedSections: { x: true },
          collapsedItems: { y: true },
          paneOrder: ["a", "b"],
          minimizedPanes: ["c"],
          paneWidths: { p: 1 },
          previewZoom: 1,
          pageFit: "width",
          sidebarMode: "variants",
          focus: null,
          toasts: [],
        })),
        (sliceWithJunk) => {
          const payload = buildPayload(sliceWithJunk);
          expect(Object.keys(payload).sort()).toStrictEqual(
            ["bank", "currentVariantId", "payloadVersion", "variants"].sort()
          );
          for (const key of UI_KEYS) {
            expect(key in payload).toBe(false);
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

describe("Feature: oauth-authentication, Property 2: Merge is a union over ids", () => {
  it("merged variant and bank id sets equal the union of the input id sets", () => {
    fc.assert(
      fc.property(arbCloudAndLocal, ({ cloud, local }) => {
        const merged = mergeLibraries(cloud, local);
        expect(ids(merged.variants)).toStrictEqual(
          union(ids(cloud.variants), ids(local.variants))
        );
        expect(ids(merged.bank)).toStrictEqual(
          union(ids(cloud.bank), ids(local.bank))
        );
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe("Feature: oauth-authentication, Property 3: Merge has no duplicates", () => {
  it("merged variants and bank each have no repeated id", () => {
    fc.assert(
      fc.property(arbCloudAndLocal, ({ cloud, local }) => {
        const merged = mergeLibraries(cloud, local);
        const variantIds = merged.variants.map((v) => v.id);
        const bankIds = merged.bank.map((b) => b.id);
        expect(variantIds.length).toBe(new Set(variantIds).size);
        expect(bankIds.length).toBe(new Set(bankIds).size);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe("Feature: oauth-authentication, Property 5: currentVariantId stays valid", () => {
  it("the merged currentVariantId always identifies a merged variant", () => {
    fc.assert(
      fc.property(arbCloudAndLocal, ({ cloud, local }) => {
        const merged = mergeLibraries(cloud, local);
        // When any variant survives the merge, currentVariantId must name one.
        // (With both sides empty there is nothing to identify.)
        if (merged.variants.length > 0) {
          expect(merged.variants.some((v) => v.id === merged.currentVariantId)).toBe(
            true
          );
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

describe("Feature: oauth-authentication, Property 6: Cloud-newer is a strict comparison", () => {
  // Distinct ISO timestamps, ordered, so "strictly after" and "equal" are both
  // exercised.
  const arbInstant = fc
    .date({
      min: new Date("2000-01-01T00:00:00.000Z"),
      max: new Date("2100-01-01T00:00:00.000Z"),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString());

  it("isCloudNewer is true iff the row timestamp is strictly after the marker", () => {
    fc.assert(
      fc.property(arbInstant, arbInstant, (row, marker) => {
        const expected = Date.parse(row) > Date.parse(marker);
        expect(isCloudNewer(row, marker)).toBe(expected);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("equal timestamps are never newer", () => {
    fc.assert(
      fc.property(arbInstant, (ts) => {
        expect(isCloudNewer(ts, ts)).toBe(false);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});

// Guard: the minimal objects the arbitraries build really satisfy the zod
// schemas the payload is validated against, so these properties test the same
// shapes the controller will.
describe("arbitrary sanity: minimal objects satisfy the zod schemas", () => {
  it("minimal Resume and BankItem parse", () => {
    expect(ResumeSchema.safeParse(resumeWithId("id-0")).success).toBe(true);
    expect(BankItemSchema.safeParse(bankItemWithId("id-0")).success).toBe(true);
  });
});
