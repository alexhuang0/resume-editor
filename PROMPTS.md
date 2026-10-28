# Tailoring prompts

The prompt below is the one you paste into Claude.ai alongside a job posting to tailor a
resume variant. The workflow is a round trip:

1. In the app, **Export JSON** (or hit **Copy tailoring prompt**) to get the active variant as a
   single-variant JSON document.
2. Paste the prompt, the JSON, and the job posting into Claude.ai.
3. Paste Claude's reply back through **Import JSON**.

The JSON you export is the canonical artifact (see [ONBOARDING.md](./ONBOARDING.md)). Everything
downstream — the preview, the PDF, the Markdown — is rendered from it. Claude edits the JSON in
place and the app re-imports it, so the rules below exist to keep that round trip lossless.

---

## The prompt

Copy everything in the block below, then paste your resume JSON and the job posting under it.

```text
You are tailoring a resume to a specific job posting. I will give you (1) a resume as a
single JSON document and (2) a job posting. Edit the JSON so the resume targets the posting,
then return the COMPLETE edited JSON document.

Follow these rules exactly. They are not style preferences — breaking them corrupts the file
when I re-import it.

RULES

1. Preserve every `id` verbatim. Every item and every bullet has an `id`. Copy each one
   through unchanged. Do not regenerate, renumber, reformat, or "tidy" ids, and never invent
   new ones. If you reword a bullet, the reworded text keeps the SAME id it had before. (The
   next section explains why this is the single most important rule.)

2. Omit content by hiding it, never by deleting it. To drop a bullet, item, or section from
   this variant, set `"hidden": true` on that node. Do NOT remove it from its array. Hidden
   nodes stay in the document so they can be re-enabled for a future variant; a deleted node
   is gone. If something is already hidden and you want it shown, set `"hidden": false` or
   remove the flag.

3. Reorder by moving array elements. Render order IS array order — there is no `order` field.
   To promote a bullet or reorder jobs, move the element within its array, carrying its `id`
   and all its fields with it.

4. Reword freely; never invent experience. You may rewrite headings, bullet text, and phrasing
   to match the posting's language and emphasis. You may NOT add jobs, projects, bullets, or
   claims describing things the person did not do. Rewording an existing bullet is fine;
   fabricating a new accomplishment is not.

5. Leave `link`, `hiddenBulletIds`, and `bulletOrder` exactly as you found them. These three
   fields are inert metadata that the app reads on re-import. Do not add, remove, reorder, or
   edit them. In particular, `hiddenBulletIds` will often name bullet ids that do NOT appear
   anywhere in this document. That is correct and expected — it is not stale data, a mistake,
   or something to clean up. Pass all three through untouched on every item that has them.

6. Return the complete JSON document, not a diff, patch, fragment, or summary. Your entire
   reply should be the full edited JSON — same top-level shape, every section, every item,
   every bullet — ready to paste back as-is. No commentary before or after it, no code fences
   around a partial object.
```

---

## Why ids matter

Rule 1 is the one that silently loses work if it's broken, so it's worth understanding.

When you re-import the edited JSON, the app does not blindly overwrite the variant. For any item
that is linked to a shared bank entry, it runs a reconciler that compares the imported wording
against the bank's wording to decide whether you changed anything. That comparison is keyed on
`id`. The reconciler walks the bullet lists in order and matches bullets by `(id, text, hidden)`
to classify the item as unchanged (still linked to the bank) or diverged (your edit is kept and
the item is detached from the bank).

A bullet's `id` is its identity across that comparison. If Claude rewords a bullet but keeps its
`id`, the reconciler sees the same bullet with new text — a genuine edit — and preserves it as a
divergence, so your tailored wording survives and only the items you actually touched come back
amber. If Claude regenerates the `id`, the reconciler can no longer line that bullet up with its
former self: the old id looks like a bullet that was removed, and the new id looks like a bullet
that was added. The reword reads as a delete-plus-add, and its lineage is lost. You end up with a
bullet that is textually fine but has been severed from the entry it came from, which breaks the
link that lets one edit in the bank update every variant that shares it.

Same logic one level up: item ids anchor each item to its section and, when linked, to its bank
entry. Changing an item's `id` turns a tailored item into an orphan.

So: rewording is encouraged, reordering is encouraged, hiding is how you trim — but ids are the
thread that ties the edited document back to what it came from. Keep every one verbatim.

---

## About the exported shape

What you export (and paste to Claude) is a single, self-contained variant: `schemaVersion`, the
`header`, and the `sections` array, with every linked item's wording already inlined so the file
reads on its own without the bank. Alongside that inlined wording, items may still carry `link`,
`hiddenBulletIds`, and `bulletOrder` — the inert metadata rule 5 protects. The app strips its
internal UI-only flags before export, so what Claude sees is exactly what the app will read back.
Leave the structure as-is and the round trip holds.
