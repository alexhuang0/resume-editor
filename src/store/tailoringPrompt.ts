import type { BankItem, Resume } from "./schema";
import { resumeJsonPayload } from "../exporters/importExport";

/**
 * The tailoring rules prompt (Req 12.1, 12.2).
 *
 * This is the single source of truth for the rules text. It is reproduced
 * verbatim inside the ```text fenced block of PROMPTS.md (tasks 11.1/11.2), and
 * `tailoringPrompt.test.ts` reads that block back and asserts the two match, so
 * the file a human reads and the text the Copy button writes can never drift.
 * If you edit one, edit the other and the test will keep you honest.
 */
export const TAILORING_RULES_PROMPT = `You are tailoring a resume to a specific job posting. I will give you (1) a resume as a
single JSON document and (2) a job posting. Edit the JSON so the resume targets the posting,
then return the COMPLETE edited JSON document.

Follow these rules exactly. They are not style preferences — breaking them corrupts the file
when I re-import it.

RULES

1. Preserve every \`id\` verbatim. Every item and every bullet has an \`id\`. Copy each one
   through unchanged. Do not regenerate, renumber, reformat, or "tidy" ids, and never invent
   new ones. If you reword a bullet, the reworded text keeps the SAME id it had before. (The
   next section explains why this is the single most important rule.)

2. Omit content by hiding it, never by deleting it. To drop a bullet, item, or section from
   this variant, set \`"hidden": true\` on that node. Do NOT remove it from its array. Hidden
   nodes stay in the document so they can be re-enabled for a future variant; a deleted node
   is gone. If something is already hidden and you want it shown, set \`"hidden": false\` or
   remove the flag.

3. Reorder by moving array elements. Render order IS array order — there is no \`order\` field.
   To promote a bullet or reorder jobs, move the element within its array, carrying its \`id\`
   and all its fields with it.

4. Reword freely; never invent experience. You may rewrite headings, bullet text, and phrasing
   to match the posting's language and emphasis. You may NOT add jobs, projects, bullets, or
   claims describing things the person did not do. Rewording an existing bullet is fine;
   fabricating a new accomplishment is not.

5. Leave \`link\`, \`hiddenBulletIds\`, and \`bulletOrder\` exactly as you found them. These three
   fields are inert metadata that the app reads on re-import. Do not add, remove, reorder, or
   edit them. In particular, \`hiddenBulletIds\` will often name bullet ids that do NOT appear
   anywhere in this document. That is correct and expected — it is not stale data, a mistake,
   or something to clean up. Pass all three through untouched on every item that has them.

6. Return the complete JSON document, not a diff, patch, fragment, or summary. Your entire
   reply should be the full edited JSON — same top-level shape, every section, every item,
   every bullet — ready to paste back as-is. No commentary before or after it, no code fences
   around a partial object.`;

/**
 * Build the full clipboard payload for the "Copy tailoring prompt" button
 * (Req 12.2): the rules, then the active variant's exported (resolved) JSON,
 * in the order PROMPTS.md tells the user to paste them ("paste your resume JSON
 * and the job posting under it").
 *
 * The JSON half is produced by `resumeJsonPayload`, the exact serializer behind
 * Export JSON, so a copied payload embeds a byte-identical artifact: linked
 * items inlined from the bank, the `orphaned` UI flag stripped, `link` /
 * `hiddenBulletIds` / `bulletOrder` retained as inert metadata.
 *
 * Pure and total: no store, no clipboard, no React. The caller handles the
 * clipboard write and the toast.
 */
export function buildTailoringPrompt(variant: Resume, bank: BankItem[] = []): string {
  return `${TAILORING_RULES_PROMPT}\n\n${resumeJsonPayload(variant, bank)}`;
}
