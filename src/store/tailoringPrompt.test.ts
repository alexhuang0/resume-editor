import { describe, expect, it } from "vitest";
import promptsMd from "../../PROMPTS.md?raw";
import { buildTailoringPrompt, TAILORING_RULES_PROMPT } from "./tailoringPrompt";
import { resumeJsonPayload } from "../exporters/importExport";
import { CURRENT_SCHEMA_VERSION } from "./schema";
import type { BankItem, Item, Resume } from "./schema";

/**
 * Task 11.3: `buildTailoringPrompt` is the pure payload behind the
 * "Copy tailoring prompt" button — the rules text followed by the active
 * variant's exported (resolved) JSON.
 *
 * **Validates: Requirements 12.1, 12.2, 10.1**
 */

const bankEntry: BankItem = {
  id: "bank1",
  heading: "Bank Heading",
  subheading: "Bank Sub",
  location: "Remote",
  dateRange: "2020 - 2022",
  bullets: [
    { id: "b1", text: "Bank bullet one" },
    { id: "b2", text: "Bank bullet two" },
  ],
} as BankItem;

const linked: Item = {
  id: "i-linked",
  bullets: [],
  link: { bankId: "bank1" },
  hiddenBulletIds: ["b2"],
};

const local: Item = {
  id: "i-local",
  heading: "Local Heading",
  bullets: [{ id: "lb1", text: "Local bullet" }],
};

function variant(items: Item[]): Resume {
  return {
    id: "r1",
    name: "V",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    header: { name: "N", fields: [] },
    sections: [{ id: "s1", kind: "experience", title: "Experience", items }],
  } as unknown as Resume;
}

describe("TAILORING_RULES_PROMPT", () => {
  it("contains the key rule phrases", () => {
    // Rule 1: preserve ids verbatim.
    expect(TAILORING_RULES_PROMPT).toContain("Preserve every `id` verbatim");
    // Rule 2: hiding, not deletion.
    expect(TAILORING_RULES_PROMPT).toContain("never by deleting it");
    expect(TAILORING_RULES_PROMPT).toContain('"hidden": true');
    // Rule 5: inert metadata untouched.
    expect(TAILORING_RULES_PROMPT).toContain(
      "Leave `link`, `hiddenBulletIds`, and `bulletOrder` exactly as you found them"
    );
    // Rule 6: return the complete document.
    expect(TAILORING_RULES_PROMPT).toContain("Return the complete JSON document");
  });

  it("matches the prompt block in PROMPTS.md so the two cannot drift", () => {
    // Extract the first ```text ... ``` fenced block — the canonical prompt.
    const match = promptsMd.match(/```text\n([\s\S]*?)\n```/);
    expect(match, "PROMPTS.md must contain a ```text fenced prompt block").toBeTruthy();
    const fenced = match![1];
    expect(fenced).toBe(TAILORING_RULES_PROMPT);
  });
});

describe("buildTailoringPrompt", () => {
  it("leads with the rules and ends with the exact resumeJsonPayload output", () => {
    const out = buildTailoringPrompt(variant([linked, local]), [bankEntry]);
    const json = resumeJsonPayload(variant([linked, local]), [bankEntry]);

    expect(out.startsWith(TAILORING_RULES_PROMPT)).toBe(true);
    expect(out.endsWith(json)).toBe(true);
    // Rules first, JSON under it (PROMPTS.md paste order).
    expect(out).toBe(`${TAILORING_RULES_PROMPT}\n\n${json}`);
  });

  it("inlines (resolves) linked items in the embedded JSON", () => {
    const out = buildTailoringPrompt(variant([linked, local]), [bankEntry]);
    // The embedded JSON is everything after the rules block.
    const json = out.slice(TAILORING_RULES_PROMPT.length);
    const parsed = JSON.parse(json.trimStart());
    const [a] = parsed.sections[0].items;

    // Linked item took its wording from the bank, with the overlay applied
    // (b2 hidden), and kept its link + overlay metadata.
    expect(a.heading).toBe("Bank Heading");
    expect(a.bullets.map((x: { text: string }) => x.text)).toEqual(["Bank bullet one"]);
    expect(a.link).toEqual({ bankId: "bank1" });
    expect(a.hiddenBulletIds).toEqual(["b2"]);
  });

  it("defaults to an empty bank and does not throw with no links", () => {
    const v = variant([local]);
    expect(buildTailoringPrompt(v)).toBe(
      `${TAILORING_RULES_PROMPT}\n\n${resumeJsonPayload(v)}`
    );
  });
});
