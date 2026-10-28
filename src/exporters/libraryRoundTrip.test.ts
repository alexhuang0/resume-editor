import { describe, expect, it } from "vitest";
import { useResumeStore } from "../store/resumeStore";
import { CURRENT_SCHEMA_VERSION } from "../store/schema";
import type { BankItem } from "../store/schema";
import { libraryJsonPayload, parseImport } from "./importExport";

const bankItem: BankItem = {
  id: "bk_1",
  kind: "experience",
  label: "Acme SWE",
  heading: "Acme",
  subheading: "Engineer",
  bullets: [{ id: "b_1", text: "Shipped **things**" }],
  updatedAt: "2025-01-01T00:00:00.000Z",
};

describe("library backup carries the bank (5.3)", () => {
  it("export -> parseImport -> replaceLibrary restores variants and bank verbatim", () => {
    const { variants } = useResumeStore.getState();
    const payload = libraryJsonPayload(variants, [bankItem]);
    expect(JSON.parse(payload).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    const parsed = parseImport(payload);
    if (parsed.kind !== "library") throw new Error("expected library");
    expect(parsed.bank).toEqual([bankItem]);

    useResumeStore.setState({ bank: [] });
    useResumeStore.getState().replaceLibrary(parsed.variants, parsed.bank);

    const s = useResumeStore.getState();
    expect(s.bank).toEqual([bankItem]);
    expect(s.variants).toEqual(variants);
    expect(s.currentVariantId).toBe(variants[0].id);
  });

  it("a v3 library with no bank key imports with an empty bank", () => {
    const { variants } = useResumeStore.getState();
    const raw = JSON.stringify({ schemaVersion: 3, variants });
    const parsed = parseImport(raw);
    if (parsed.kind !== "library") throw new Error("expected library");
    expect(parsed.bank).toEqual([]);
  });

  it("the store seeds an empty bank", () => {
    useResumeStore.setState({ bank: [] });
    expect(useResumeStore.getState().bank).toEqual([]);
  });
});
