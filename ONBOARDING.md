# Onboarding

Written for future-me returning to this repo after months away. Goal: get the *why* and the gotchas back in 5 minutes, so you don't accidentally break a load-bearing invariant trying to "tidy up."

If you'd rather read code, jump to [CLAUDE.md](./CLAUDE.md) — that's the architecture map.

---

## If you only read three things

1. **The JSON in `src/store/schema.ts` is the canonical artifact.** Everything else (the UI, the PDF, the Markdown) is downstream. The whole point of this app is that you can hand that JSON to Claude.ai with a job posting and re-import Claude's edited JSON. The prompt and round-trip rules are in [PROMPTS.md](./PROMPTS.md). Don't put UI-only fields in it.
2. **`hidden: true` is how you tailor — not deletion.** Every Section, Item, Bullet, and Header contact field has a `hidden` flag. Hidden nodes vanish from the preview/PDF/Markdown but stay in the JSON, so you can re-enable them for the next variant. Tailoring actions should toggle `hidden`, not splice arrays.
3. **Before shipping a change, run the verification ritual.** `npm test` (vitest) now covers the pure core, but the ritual in §8 still owns everything a unit test can't reach — PDF fidelity, drag-and-drop, ATS-parseability. Run both (see below).

---

## Why this exists

You apply to many roles. Each one needs the resume reordered, with some bullets/jobs omitted and others added. Editing the Jake's-resume LaTeX in VSCode is too slow for that cadence. Instead: edit visually in this web app, export the resume as JSON, paste it to Claude.ai with the job posting, get back tailored JSON, re-import, and print.

The JSON-as-canonical-artifact is the load-bearing decision. PDFs and Markdown are lossy; Claude can edit JSON precisely and you can re-import it without manual re-entry.

---

## Mental model in 5 minutes

The resume has two flexible parts:

**Header** — a fixed `fullName` field (the `<h1>`) plus a `fields[]` array of contact entries. Each field has an `id`, `label` (display text), optional `url` (use `mailto:` for email), and optional `hidden`. You can add arbitrary fields (e.g. "English/Arabic (bilingual)"), reorder them, and hide them per variant. This is how you show bilingual status in one variant and omit it in another.

**Body** — three nested levels: **Section → Item → Bullet**. Each level has a stable `id`, an optional `hidden` boolean, and lives in an array where **array index = render order**. Drag-to-reorder is literally a mutation of those arrays.

Two zustand stores:

- `resumeStore` — variants library, persisted to `localStorage` under `resume-editor:v1`. **Source of truth for content.**
- `uiStore` — focus, collapsed sections, toasts, plus **pane layout** (`paneOrder`, `minimizedPanes`). **Never persisted, never exported.** Pane layout resetting on reload is intentional: it's a viewing preference, not part of your resume.

The three panes (Variants, Editor, Preview) have a top bar with a drag handle and a minimize button. Drag horizontally to reorder them; minimize collapses a pane to a 32px vertical strip. Handy when you want the preview to dominate before printing.

Preview and print share the *same* CSS (`src/styles/resume.css`). The `@media print` rule in `styles/app.css` hides the pane bars and non-preview wrappers so only the rendered page goes to the printer. PDF export is `window.print()` — no library.

For the full architecture, read [CLAUDE.md](./CLAUDE.md).

---

## First-run setup

```bash
npm install
npm run dev          # http://localhost:5173
```

**localStorage gotcha:** your variants live in *one specific browser profile on this machine*. If you clear site data, switch browsers, or move to a new machine without exporting, they're gone. Click **Export all (backup)** in the sidebar periodically. To restore on a new machine, **Import JSON** of the backup file.

---

## Invariants you'll regret breaking

- **`Resume` schema (`src/store/schema.ts`) is the contract with Claude.ai.** Field names should be obvious to an LLM editing in place. Don't put UI ephemera here — that's `uiStore`'s job.
- **The PDF must stay ATS-parseable.** No text inside SVG/images. No CSS columns or `<table>` for layout. Single-column flow. Contact info in the document body, not a print header/footer. Bullet markers via CSS `list-style` only.
- **`hidden: true` removes from output, never from data.** This applies at every level: Section, Item, Bullet, and Header contact field. Tailoring actions (especially anything Claude does in the JSON) should toggle `hidden`, not delete. The user's mental model is "I'll need this for the *next* role."
- **The bank owns wording; the variant owns visibility and order.** A linked item stores no wording of its own — empty content fields, `bullets: []` — and reads its text from the bank entry at render time (`src/store/resolve.ts`). What the variant keeps on top is `hidden`, `hiddenBulletIds`, and `bulletOrder`. So hiding or reordering a bullet on a linked item is variant-local and keeps the link; editing wording auto-detaches the item first (it becomes its own local copy). Don't write wording onto a linked item or the resolver will ignore it.
- **Bump `schemaVersion` if you change the shape.** Add a migration step in `src/store/migrations.ts` and wire it into both `parseImport` (`src/exporters/importExport.ts`) and the zustand `migrate` function in `resumeStore.ts`. Otherwise re-importing older JSON files or loading old localStorage data silently breaks. Current `schemaVersion` is 3 (`CURRENT_SCHEMA_VERSION` in `src/store/schema.ts`). The reference example is the v2→v3 bump (the item bank): `migrateResumeV2toV3` just sets `schemaVersion: 3` and rewrites nothing — a v2 item has no `link`, so the resolver renders it from its own fields exactly as before — and `migratePersistedLibrary` chains v1→v2→v3 in one pass while defaulting `bank: []` for any pre-bank state. Keep each step small and one-way (version N → N+1) so the chain stays readable.
- **Array index = render order, everywhere.** Don't introduce a parallel `order: number` field — order *is* the array.

---

## Non-obvious decisions and why

**Why no PDF library?** Browser print produces real text glyphs (selectable, ATS-parseable), embeds the chosen font, and uses the exact same CSS as the on-screen preview. A JS PDF lib would re-render and the output would diverge from preview.

**Why `localStorage` and not File System Access API?** Zero config, no permission prompt, works in every browser. The escape hatch is JSON Import/Export — that's how you back up, share with Claude, and migrate machines.

**What the test suite covers, and what it deliberately doesn't.** There is now a vitest suite — `npm test` — but it is scoped narrowly to the pure core: the resolver (`src/store/resolve.ts`), the schema migration (`src/store/migrations.ts`), the import-side divergence detector (`src/store/reconcile.ts`), and the preview/page-fit math (`src/components/Preview/previewScale.ts`). These are pure functions over plain data, so they're worth pinning — including property-based tests (fast-check) that check invariants across generated inputs (resolution is identity on local/detached items, linked items never accumulate local wording, divergence keeps exactly what the user changed, scale stays bounded, and so on). No jsdom, no component tests. The suite exists because the bank's link lifecycle has real invariants that are cheap to assert and expensive to re-verify by hand.

What vitest does **not** touch is exactly what it couldn't exercise meaningfully: PDF visual fidelity, drag-and-drop UX, and ATS-parseability. A unit test that "passed" on those would build false confidence. Those stay the job of the manual ritual in §8 — run it every time before considering a change "done," and run `npm test` alongside it.

**Why a separate `uiStore`?** So the exported JSON stays free of UI ephemera (which section is collapsed, what's focused, toast queue). The portability invariant says: take the JSON files + `schema.ts` and you can rebuild the app or migrate to a different tool. UI state would pollute that.

**Why Latin Modern with a Georgia toggle?** Latin Modern Roman matches Jake's LaTeX output visually. Georgia is the escape hatch when a picky ATS parser chokes on the embedded Latin Modern font — ubiquitous serif, never refused.

**Why markdown syntax in string fields instead of a rich-text editor?** Inline formatting (`[text](url)`, `**bold**`, `*italic*`) is stored as literal markdown syntax in the existing `string` fields — no schema change, no new node types. This keeps the JSON readable to an LLM (Claude.ai natively outputs markdown) and avoids a contentEditable editor or a serialisation layer. The parser in `src/utils/inlineMarkdown.tsx` converts it to `<a>`, `<strong>`, `<em>` at render time. ATS-safe because those are standard semantic HTML elements.

**Why three editor panes instead of WYSIWYG?** WYSIWYG editing of a print-fidelity document is hard to get right and would conflict with drag-to-reorder + hide toggles. Split view (sidebar | editor | preview) is boring but fast.

---

## First-edit recipe (smoke test)

Use this after `npm install` to confirm everything still works before making real changes:

1. Open the app. The Default variant is seeded with Jake's-resume content. Right pane shows the rendered page.
2. Edit a bullet in Experience. Preview updates live. Reload — your edit persisted, and pane layout reset (that's intentional; pane order/minimized state is ephemeral).
3. Drag the Editor pane's top bar to swap its position with the Preview pane. Minimize the Variants pane using the `−` button — it collapses to a vertical strip. Expand it again.
4. In the Header, drag a contact field to reorder it. Toggle hide (eye icon) on one — preview drops it from the contact line; the field stays in the editor dimmed.
5. Drag a section to reorder. Drag a bullet to a new position within an item.
6. Toggle hide (eye icon) on a bullet. Preview drops it; the bullet stays in the editor with strikethrough.
7. **Export JSON** the active variant. Open the file, eyeball the schema — you should see `header.fields[]` (not bare `email`/`phone` fields) and `schemaVersion: 3`. Click **Import JSON**, choose "add as new variant" — preview is identical.
8. Type `[Google](https://google.com)` into a bullet, `**bold**` into another, `*italic*` into a third. Preview should render an underlined link, bold text, and italic text respectively.
9. `Cmd+P` → Save as PDF. Open the PDF, `Cmd+A` `Cmd+C`, paste into a plain-text editor — should be linear, selectable, ATS-parseable (link renders as anchor text only, no raw markdown syntax).

If any of those steps fails, fix it before doing anything else.

---

## Verification ritual before shipping a change

Same vibe as §7 but more thorough — run this after a real code change:

1. `npm run build` — type-check + production build must pass. `npm test` — the pure-core suite must pass too (see "What the test suite covers" above for its scope).
2. `npm run dev`, edit + reload — persistence still works.
3. Drag at all four levels: Header contact field, section, item within a section, bullet within an item.
4. Hide and re-show at all four levels (including a Header contact field).
5. Create a second variant, switch between them — no cross-contamination.
6. Export JSON of the active variant; re-import as a new variant; preview matches.
7. Export all (library backup); import all on a fresh browser profile if you can; library restores.
8. `Cmd+P` → Save as PDF. Visually compare against a known-good PDF (or the Jake's LaTeX original if you still have one).
9. PDF text extraction: open the PDF, `Cmd+A` `Cmd+C`, paste — confirm linear and clean. Inline-formatted text (`**bold**`, `[text](url)`) should appear as plain text with no markdown syntax leaking into the paste.
10. **Markdown export** reads well; no IDs or internal cruft leaked.

The bank is the load-bearing feature now, so exercise its link lifecycle too (these assume a bank entry linked into at least two variants — use the guided importer in the Bank panel's empty state to seed one if you don't have it):

11. **Edit propagates to two variants.** Link one bank entry into variant A and variant B (both show a green dot on the item). Open the Bank panel, reword a bullet on that entry. Switch to A, then B — both previews show the new wording with no re-import. This is the whole point of the bank; if it doesn't propagate, stop and fix it.
12. **Detach.** On a linked item, edit its wording in the editor. It auto-detaches: badge flips green → amber, the edit is local to that variant, and the other variant linked to the same entry is unchanged.
13. **Resync.** On that detached (amber) item, click Resync. Its wording hard-overwrites from the bank and the badge goes back to green. Confirm the toast warns that resync discards variant-local hidden/order (per design §4.3 — resync does not reconstruct `hiddenBulletIds`/`bulletOrder` from baked flags). Undo from the toast and confirm the pre-resync state returns.
14. **Push to bank.** Detach a linked item again, reword it, click Push to bank. The bank entry takes the new wording, the item relinks (amber → green, local wording cleared), and the *other* variant linked to that entry picks up the pushed wording.
15. **Delete a referenced bank item (orphan-on-delete).** Delete a bank entry that two variants reference. The delete is never blocked by a reference count: both referencing items keep their content as local copies (no badge, wording intact in each variant), and the toast's Undo restores the entry and re-links both.
16. **Export → edit → re-import divergence round trip.** Export a variant to JSON, open the file, reword exactly two items, re-import. Confirm exactly those two items go amber (detached) and the rest stay green, and that a summary toast names the count ("2 items diverged from the bank — review"). Then the no-op case that catches the overlay bug: hide a bullet on a linked item, export, re-import the file unchanged — the diverged count is zero and the item stays green.

Done = all 16 pass.

---

## Where things are

| Concern | Path |
|---|---|
| Schema + types | `src/store/schema.ts` |
| Seed content | `src/store/seed.ts` |
| Content store | `src/store/resumeStore.ts` |
| UI store | `src/store/uiStore.ts` |
| Editor components | `src/components/Editor/` |
| Variants sidebar | `src/components/VariantsSidebar.tsx` |
| Renderer (preview + print) | `src/components/Preview/ResumePreview.tsx` |
| Inline text formatter | `src/utils/inlineMarkdown.tsx` |
| JSON import/export | `src/exporters/importExport.ts` |
| Markdown export | `src/exporters/toMarkdown.ts` |
| Keyboard shortcuts | `src/hooks/useShortcuts.ts` |
| App chrome CSS | `src/styles/app.css` |
| Page + print CSS | `src/styles/resume.css` |

Defer to [CLAUDE.md](./CLAUDE.md) for the architectural depth (store contracts, dnd-kit nesting, delete-with-undo pattern, etc.).

---

## What lives outside the repo

These exist on the machine where this project was built. They aren't required to use the app, but they hold useful context if you have access:

- `~/.claude/projects/-Users-gatallah-Dev-resume-editor/memory/` — Claude Code auto-memory. Holds the project rationale (`project_resume_editor.md`), the user-role profile, and feedback notes from the build session.
- `~/.claude/plans/i-apply-to-many-sunny-hearth.md` — the approved build plan (later overwritten by the onboarding-doc plan). Useful as a record of the original design decisions.

Assume future-you may not have these. The repo (this file + `CLAUDE.md` + the code) should stand on its own.
