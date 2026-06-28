# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local web app for editing a Jake's-resume-style CV visually and exporting to PDF (via browser print) and Markdown. The user applies to many roles, tailors heavily per posting, and uses Claude.ai for AI-assisted tailoring by round-tripping a **JSON artifact** — not a PDF or text dump. Everything else (UI state, PDF, Markdown) is downstream of that JSON.

## Commands

```bash
npm run dev       # Vite dev server at http://localhost:5173
npm run build     # tsc -b + vite build (must pass before shipping)
npm run lint      # oxlint
npm run preview   # serve the built dist/
```

There is no test suite. The verification path is manual: walk through the 10-step checklist in `~/.claude/plans/i-apply-to-many-sunny-hearth.md`.

## Architecture

Three-pane SPA: `VariantsSidebar | Editor (HeaderEditor + SectionList) | ResumePreview`. State lives in two zustand stores:

- **`src/store/resumeStore.ts`** — the variants library, persisted to `localStorage` under `resume-editor:v1`. All resume content mutations go through this store's actions (`addBullet`, `reorderItems`, `toggleSectionHidden`, etc.). Use `useCurrentResume()` to read the active variant.
- **`src/store/uiStore.ts`** — ephemeral UI state: `focus` (which node the keyboard shortcuts target), collapsed sections, toast queue. **Never** persisted, never exported.

### Three-level nesting

`Resume → Section → Item → Bullet`. Every level has:
- A stable `id` (string) used as the React key and dnd-kit sortable id.
- An optional `hidden` flag — set true to omit from preview/PDF/Markdown but keep in JSON. This is the "omit without deleting" mechanism the user relies on for tailoring.
- Array order = render order. Reordering is just a mutation of the array.

dnd-kit `SortableContext` is set up at all three levels (`SectionList`, `SectionEditor` for items, `BulletList` for bullets).

### The JSON artifact contract

`src/store/schema.ts` defines the canonical `Resume` shape with `zod`. This schema is **the contract with Claude.ai** — the user exports JSON, pastes it into Claude with a job posting, and re-imports Claude's modified JSON. When changing the schema:

- Bump `schemaVersion` (currently `2`) and add a migration in `exporters/importExport.ts::parseImport`.
- Keep field names obvious and stable so an LLM can edit the JSON in place.
- Don't add UI-only fields here — those belong in `uiStore`.

`parseImport` auto-detects whether the file is a single `Resume` or a full `Library` (`Export all` backup).

### Inline formatting in text fields

All text fields (bullet text, heading, subheading, location, dateRange, skill row content) support markdown inline syntax, parsed by `src/utils/inlineMarkdown.tsx` at render time:

| Syntax | Output |
|---|---|
| `[text](url)` | `<a>` — bare domains auto-promoted to `https://` |
| `**text**` | `<strong>` |
| `*text*` | `<em>` |

The syntax is stored as-is in the existing `string` fields — **no schema changes**. This makes Claude.ai round-trips natural since it natively outputs markdown. ATS-safe: only standard semantic HTML elements are used; text content is always extractable by parsers.

`toMarkdown.ts` requires no changes — inline markdown in bullet text is already valid markdown output.

### Preview = print

`src/styles/resume.css` styles the `.page` element for both screen preview and `@media print`. `src/styles/app.css` hides everything except `.page` when printing. PDF export is just `window.print()` — no PDF library. This is intentional: the browser produces real text glyphs (ATS-parseable), embeds the font, and gives the best fidelity for the LaTeX-style look.

### ATS-friendliness is a hard requirement

The output must remain parseable by Applicant Tracking Systems. When changing the renderer or print CSS:
- Single-column layout end-to-end. Right-aligned location/date uses flexbox on the same line — not CSS columns or tables.
- No text inside images or SVGs. Bullet markers use CSS `list-style`.
- Contact info lives in the document body, not a PDF header/footer.
- The per-variant `font` field lets users swap Latin Modern (LaTeX look) for Georgia (max ATS compat). Preserve that toggle.

### Delete-with-undo pattern

Section / Item / Bullet deletes capture the node and its index, call the store delete action, then push a toast with an `undo` callback that calls the corresponding `insert*` action. Follow this pattern for any new destructive action.

### Keyboard shortcuts

`src/hooks/useShortcuts.ts` reads `uiStore.focus` (set by `onFocus` handlers in editor components) and dispatches shortcuts (`Cmd+Enter`, `Cmd+Shift+Enter`, `Cmd+↑/↓`, `Cmd+D`, `Cmd+H`) against the focused node's section/item/bullet. New nodes should call `setFocus` in their `onFocus` handler to participate.

## Out of scope (don't add)

These were explicitly excluded during planning to keep the app focused:
- Cloud sync, accounts, multi-device, version history.
- In-browser LaTeX engine (Tectonic / WASM).
- AI tailoring inside the app — Claude.ai is the tailoring surface; this app is the editor + artifact source.
- Cover letters, multi-page layouts, themes.
