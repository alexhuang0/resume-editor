import { describe, expect, it } from "vitest";
import { resumeJsonPayload } from "./importExport";
import { contentEquals } from "../store/reconcile";
import { resolveItem } from "../store/resolve";
import { CURRENT_SCHEMA_VERSION } from "../store/schema";
import type { BankItem, Item, Resume } from "../store/schema";

/**
 * Task 9.3, the operand note: the reconciler compares an imported item against
 * `resolveItem(imported, bankById)` (the bank's wording as resolved under that
 * item's OWN overlay), never against the raw bank entry. These tests run the
 * real export path so they document why: export inlines the overlay-applied
 * view, so a raw-entry comparison reports every item with a non-empty
 * `hiddenBulletIds` or `bulletOrder` as diverged when the user changed nothing.
 *
 * **Validates: Requirements 10.1, 10.3**
 */

const entry: BankItem = {
  id: "bank1",
  kind: "experience",
  heading: "Bank Co",
  subheading: "Engineer",
  location: "Remote",
  dateRange: "2020 - 2022",
  bullets: [
    { id: "b1", text: "one" },
    { id: "b2", text: "two" },
    { id: "b3", text: "three" },
    { id: "b4", text: "four", hidden: true }, // parked bank-wide; flows through unchanged
  ],
  updatedAt: "2024-01-01T00:00:00.000Z",
};
const bankById = new Map([[entry.id, entry]]);

type Overlay = Pick<Item, "hiddenBulletIds" | "bulletOrder">;

function exportedItem(overlay: Overlay): Item {
  const linked: Item = { id: "i1", bullets: [], link: { bankId: entry.id }, ...overlay };
  const variant: Resume = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "r1",
    name: "V",
    updatedAt: "2024-01-01T00:00:00.000Z",
    header: { fullName: "N", fields: [] },
    sections: [{ id: "s1", kind: "experience", title: "Experience", items: [linked] }],
  };
  const out = JSON.parse(resumeJsonPayload(variant, [entry])) as Resume;
  return out.sections[0].items[0];
}

describe("contentEquals operand: resolved-under-overlay, not the raw bank entry", () => {
  const overlays: [string, Overlay][] = [
    ["hiddenBulletIds only", { hiddenBulletIds: ["b2"] }],
    ["bulletOrder only", { bulletOrder: ["b3", "b1"] }],
    ["both", { hiddenBulletIds: ["b1"], bulletOrder: ["b3", "b2"] }],
  ];

  it.each(overlays)("%s: an unedited export is equal to its resolved view but not to the raw entry", (_, overlay) => {
    const imported = exportedItem(overlay);

    // Precondition: the export really did inline the overlay-applied view.
    expect(imported.hiddenBulletIds ?? []).toEqual(overlay.hiddenBulletIds ?? []);
    expect(imported.bullets.map((b) => b.id)).not.toEqual(entry.bullets.map((b) => b.id));

    expect(contentEquals(imported, resolveItem(imported, bankById))).toBe(true);
    expect(contentEquals(imported, entry)).toBe(false);
  });

  it("with no overlay both operands agree, so the overlay is the only reason the raw one fails", () => {
    const imported = exportedItem({});
    expect(contentEquals(imported, resolveItem(imported, bankById))).toBe(true);
    expect(contentEquals(imported, entry)).toBe(true);
  });

  it("a real edit is still detected against the resolved view, overlay or not", () => {
    const imported = exportedItem({ hiddenBulletIds: ["b2"], bulletOrder: ["b3", "b1"] });
    const resolved = resolveItem(imported, bankById);

    const reworded: Item = {
      ...imported,
      bullets: imported.bullets.map((b, i) => (i === 0 ? { ...b, text: "reworded" } : b)),
    };
    expect(contentEquals(reworded, resolved)).toBe(false);

    const retitled: Item = { ...imported, heading: "Bank Co, Inc." };
    expect(contentEquals(retitled, resolved)).toBe(false);

    // Claude un-hid a bullet the overlay hides (it came back inlined).
    const restoredHidden: Item = {
      ...imported,
      bullets: [...imported.bullets, { id: "b2", text: "two" }],
    };
    expect(contentEquals(restoredHidden, resolved)).toBe(false);
  });
});
