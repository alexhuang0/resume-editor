import { describe, expect, it } from "vitest";
import { bankItemDisplayLabel } from "./bankLabel";

describe("bankItemDisplayLabel (9.4)", () => {
  it("prefers the explicit label over the heading", () => {
    expect(
      bankItemDisplayLabel({ kind: "experience", label: "Backend v2", heading: "Acme" })
    ).toBe("Backend v2");
  });

  it("falls back to the heading when no label is set", () => {
    expect(bankItemDisplayLabel({ kind: "experience", heading: "Acme" })).toBe("Acme");
  });

  it("treats blank label and heading as unset", () => {
    expect(bankItemDisplayLabel({ kind: "projects", label: "  ", heading: "Side" })).toBe("Side");
    expect(bankItemDisplayLabel({ kind: "projects", label: "", heading: " " })).toBe(
      "Untitled projects"
    );
  });

  it("uses 'Untitled <kind>' when neither is set", () => {
    expect(bankItemDisplayLabel({ kind: "skills" })).toBe("Untitled skills");
  });
});
