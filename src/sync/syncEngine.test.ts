import { describe, expect, it } from "vitest";
import {
  buildPayload,
  mergeLibraries,
  isCloudNewer,
  reconcilePayloadVersion,
  PAYLOAD_VERSION,
  type LibraryPayload,
} from "./syncEngine";
import type { BankItem, Resume } from "../store/schema";

/**
 * Hand-built example tests for the pure sync-engine core (task 2.3). These pin
 * concrete cases that complement the generated property tests in 2.2:
 *
 * - Property 4: a collision on `id` resolves to the cloud entry (Req 12.5).
 * - The built payload carries no UI state, asserting the absence of a
 *   `collapsed`-prefixed key specifically (Req 12.3).
 * - Property 7: reconcile upgrades a version-2 payload through the existing
 *   `migratePersistedLibrary` (Req 12.6) and returns `too_new` with the input
 *   object left unmodified for a payload above current (Req 12.7).
 * - `isCloudNewer` on equal timestamps returns false (Req 12.8).
 *
 * _Requirements: 4.3, 6.2, 6.3, 6.4, 6.5, 12.3, 12.5, 12.6, 12.7_
 */

// ---------------------------------------------------------------------------
// Builders: minimal valid v3 shapes.
// ---------------------------------------------------------------------------

function makeResume(id: string, name: string): Resume {
  return {
    schemaVersion: 3,
    id,
    name,
    updatedAt: "2024-01-01T00:00:00.000Z",
    header: { fullName: name, fields: [] },
    sections: [],
  };
}

function makeBankItem(id: string, heading: string): BankItem {
  return {
    id,
    kind: "experience",
    heading,
    bullets: [],
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function makePayload(overrides: Partial<LibraryPayload> = {}): LibraryPayload {
  return {
    variants: [makeResume("v1", "Cloud Variant")],
    currentVariantId: "v1",
    bank: [],
    payloadVersion: PAYLOAD_VERSION,
    ...overrides,
  };
}

describe("Property 4: collision resolves to cloud (Req 12.5)", () => {
  it("keeps the cloud variant when an id is present in both cloud and local", () => {
    const cloud = makePayload({
      variants: [makeResume("shared", "Cloud Name")],
      currentVariantId: "shared",
    });
    const local = {
      variants: [makeResume("shared", "Local Name")],
      currentVariantId: "shared",
      bank: [],
    };

    const merged = mergeLibraries(cloud, local);

    expect(merged.variants).toHaveLength(1);
    expect(merged.variants[0]).toBe(cloud.variants[0]);
    expect(merged.variants[0].name).toBe("Cloud Name");
  });

  it("keeps the cloud bank entry when a bank id is present in both", () => {
    const cloud = makePayload({
      bank: [makeBankItem("b-shared", "Cloud Heading")],
    });
    const local = {
      variants: [makeResume("v-local", "Local Variant")],
      currentVariantId: "v-local",
      bank: [makeBankItem("b-shared", "Local Heading")],
    };

    const merged = mergeLibraries(cloud, local);

    const shared = merged.bank.filter((b) => b.id === "b-shared");
    expect(shared).toHaveLength(1);
    expect(shared[0]).toBe(cloud.bank[0]);
    expect(shared[0].heading).toBe("Cloud Heading");
  });
});

describe("buildPayload carries no UI state (Req 12.3)", () => {
  it("returns exactly the four payload keys and no collapsed UI-state key", () => {
    const slice = {
      variants: [makeResume("v1", "A")],
      currentVariantId: "v1",
      bank: [makeBankItem("b1", "H")],
    };

    const payload = buildPayload(slice);

    expect(Object.keys(payload).sort()).toEqual([
      "bank",
      "currentVariantId",
      "payloadVersion",
      "variants",
    ]);
    // No UI-state key leaked into the payload. `collapsedSections` /
    // `collapsedItems` are uiStore-only and must never be present.
    const keys = Object.keys(payload);
    expect(keys.some((k) => k.toLowerCase().includes("collapsed"))).toBe(false);
    expect(payload).not.toHaveProperty("collapsedSections");
    expect(payload).not.toHaveProperty("collapsedItems");
  });
});

describe("Property 7: version reconcile never mutates input", () => {
  it("upgrades a version-2 payload through migratePersistedLibrary to current (Req 12.6)", () => {
    // A valid v2 persisted library payload: variants at schemaVersion 2 (no
    // bank key, no v3-only item fields) plus currentVariantId and a v2 stamp.
    const v2Payload = {
      payloadVersion: 2,
      currentVariantId: "v2-variant",
      variants: [
        {
          schemaVersion: 2,
          id: "v2-variant",
          name: "Legacy",
          updatedAt: "2023-06-01T00:00:00.000Z",
          header: { fullName: "Legacy User", fields: [] },
          sections: [],
        },
      ],
    };

    const result = reconcilePayloadVersion(v2Payload);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.payload.payloadVersion).toBe(PAYLOAD_VERSION);
    expect(result.payload.variants).toHaveLength(1);
    expect(result.payload.variants[0].schemaVersion).toBe(3);
    expect(result.payload.variants[0].id).toBe("v2-variant");
    // migratePersistedLibrary supplies an empty bank for pre-bank states.
    expect(result.payload.bank).toEqual([]);

    // The input object was not mutated.
    expect(v2Payload.payloadVersion).toBe(2);
    expect(v2Payload.variants[0].schemaVersion).toBe(2);
    expect(v2Payload).not.toHaveProperty("bank");
  });

  it("returns too_new with the input object unmodified for a payload above current (Req 12.7)", () => {
    const tooNew = makePayload({ payloadVersion: PAYLOAD_VERSION + 1 });
    const snapshot = structuredClone(tooNew);

    const result = reconcilePayloadVersion(tooNew);

    expect(result.kind).toBe("too_new");
    // Input reference left unmodified.
    expect(tooNew).toEqual(snapshot);
    expect(tooNew.payloadVersion).toBe(PAYLOAD_VERSION + 1);
  });
});

describe("isCloudNewer equal timestamps (Req 12.8)", () => {
  it("returns false when the row timestamp equals the marker", () => {
    const ts = "2024-05-01T12:00:00.000Z";
    expect(isCloudNewer(ts, ts)).toBe(false);
  });
});
