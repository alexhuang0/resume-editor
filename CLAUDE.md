# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local web app for editing a Jake's-resume-style CV visually and exporting to PDF (via browser print) and Markdown. The user applies to many roles, tailors heavily per posting, and uses Claude.ai for AI-assisted tailoring by round-tripping a **JSON artifact** — not a PDF or text dump. Everything else (UI state, PDF, Markdown) is downstream of that JSON.

## Commands

```bash
npm run dev       # Vite dev server at http://localhost:5173
npm run build     # tsc -b + vite build (must pass before shipping)
npm test          # vitest run — the pure-core suite (resolver, migrations, reconcile, page-fit)
npm run lint      # oxlint
npm run preview   # serve the built dist/
```

`npm test` (vitest) covers the pure core — the resolver, schema migrations, the import-side divergence detector, and the preview/page-fit math — including property-based tests. It can't reach PDF fidelity, drag-and-drop, or ATS-parseability, so the manual ritual in [ONBOARDING.md](./ONBOARDING.md) §8 still owns those. Run both before shipping.

## Architecture

Three-pane SPA: `VariantsSidebar | Editor (HeaderEditor + SectionList) | ResumePreview`. Each pane is wrapped in a `SortablePane` (defined in `src/App.tsx`) with a top bar containing a drag handle and a minimize (−/+) button. Pane order is a horizontal `SortableContext` at the app root. Minimized panes collapse to a 32px strip with a rotated vertical label. State lives in two zustand stores:

- **`src/store/resumeStore.ts`** — the variants library, persisted to `localStorage` under `resume-editor:v1`. All resume content mutations go through this store's actions (`addBullet`, `reorderItems`, `toggleSectionHidden`, etc.). Use `useCurrentResume()` to read the active variant.
- **`src/store/uiStore.ts`** — ephemeral UI state: `focus` (which node the keyboard shortcuts target), collapsed sections, toast queue, plus `paneOrder: PaneId[]` and `minimizedPanes: Record<PaneId, boolean>` for the pane layout. **Never** persisted, never exported — pane layout resets on reload by design.

### Three-level nesting

`Resume → Section → Item → Bullet`. Every level has:
- A stable `id` (string) used as the React key and dnd-kit sortable id.
- An optional `hidden` flag — set true to omit from preview/PDF/Markdown but keep in JSON. This is the "omit without deleting" mechanism the user relies on for tailoring.
- Array order = render order. Reordering is just a mutation of the array.

dnd-kit `SortableContext` is set up at all three levels (`SectionList`, `SectionEditor` for items, `BulletList` for bullets).

### The item bank

The user tailors one base resume into many variants, so the same job or project appears in several variants with identical wording but different visibility and ordering. The **item bank** (`bank: BankItem[]` in `resumeStore`, persisted alongside `variants`) is the single source of that shared wording. A `BankItem` holds the four content fields (`heading`, `subheading`, `location`, `dateRange`) plus a bullet list, scoped by section `kind`.

A variant item points at a bank entry through an optional `link: { bankId, detached? }`. The rule the whole feature rests on:

**The bank owns wording. The variant owns identity, visibility, and order.**

A linked item stores **no wording of its own** — its content fields are empty and `bullets` is `[]`. What it does store is the overlay: `hiddenBulletIds` (bullets hidden in this variant only) and `bulletOrder` (this variant's bullet order). Edit the wording once in the Bank panel and every variant linked to that entry updates at once. Hide or reorder a bullet in one variant and no other variant is affected.

#### Three link states

`linkState(item)` in `src/store/resolve.ts` classifies every item into exactly one state:

- **local** — no `link`. The item owns its wording outright. This is the pre-bank behavior and what `addItem` still produces.
- **linked** — `link` present, `link.detached` falsy. Wording comes from the bank entry at read time; the item stores only the overlay. Hiding and reordering bullets stay in this state (they write the overlay); editing wording leaves it.
- **detached** — `link` present, `link.detached === true`. A local copy that remembers its origin (amber badge). It owns its wording like a local item, but `resyncItem` can pull the bank's wording back.

The transitions live in `src/store/resumeStore.ts` (`detachItem`, `resyncItem`, `pushItemToBank`, `promoteItemToBank`, `forkItemToNewBankItem`) and on the import path in `src/store/reconcile.ts`. A wording edit on a linked item auto-detaches first (see `withAutoDetach`), so an edit is never silently dropped. Design §4.3 has the full state machine.

#### Resolve-on-read

Nothing downstream reads the overlay directly. `resolveItem(item, bankById)` / `resolveResume(variant, bank)` in `src/store/resolve.ts` turn a raw variant into a fully-populated `Resume` at read time:

- **local or detached** → the item's own fields, returned as-is (today's shape, byte for byte).
- **linked** → take wording from the bank entry, drop bullets named in `hiddenBulletIds`, apply `bulletOrder` (unknown ids append, via `reorderByIds`), and carry `id`, `hidden`, and `link` through unchanged.
- **linked but the bank entry is missing** → fall back to the item's own (empty) fields with `orphaned: true` so the editor can offer recovery. Never throws.

`ResumePreview`, `toMarkdown`, and single-variant JSON export all consume the resolved `Resume`, so they need no knowledge of the bank. The overlay fields ride through resolution unchanged (already applied to `bullets`) because the exported artifact needs them for the import-side divergence check — see the two asymmetries below. Design §4.2.

#### The `useCurrentResume` memoization gotcha

`useCurrentResume()` must select the variant and the bank as **separate, reference-stable** selectors and compose them with `useMemo`. Calling `resolveResume` **inside** a zustand selector returns a brand-new object on every store notification, fails zustand's `Object.is` check, and spins a re-render loop. This costs an afternoon if hit blind.

```ts
// WRONG — new object every call, fails Object.is, re-render loop
export function useCurrentResume(): Resume {
  return useResumeStore((s) => {
    const v = s.variants.find((x) => x.id === s.currentVariantId) ?? s.variants[0];
    return resolveResume(v, s.bank); // ← fresh reference every call
  });
}

// RIGHT — select stable references, compose outside the selector
export function useCurrentResume(): Resume {
  const variant = useResumeStore(
    (s) => s.variants.find((v) => v.id === s.currentVariantId) ?? s.variants[0]
  );
  const bank = useResumeStore((s) => s.bank);
  return useMemo(() => resolveResume(variant, bank), [variant, bank]);
}
```

`variant` and `bank` already live in the store, so each selector is reference-stable and fires only when its slice changes; `useMemo` recomputes the resolved resume only then. Don't reach for `useShallow` or a custom equality fn — the fix is to stop building new objects inside a selector, not to compare them more cleverly. Design §5.1.

#### Two asymmetries worth knowing before you touch this

Both are deliberate and both will surprise you if rediscovered the hard way:

- **Detach bakes the overlay; resync discards it.** `detachItem` (via `bakeOverlay` in `resolve.ts`) applies `bulletOrder` to the local bullets and turns each `hiddenBulletIds` entry into `bullet.hidden = true` — the bullet stays in the array, flagged, since preview and Markdown both filter `hidden`. So the resolved *data* changes shape across detach even though the rendered *output* does not. `resyncItem` is a hard overwrite: it clears local content wholesale and does **not** reconstruct `hiddenBulletIds` from the baked flags, so resync drops the variant's bullet-level visibility and order along with the local wording. The undo toast is the only escape hatch; there is no three-way merge. Design §4.3.
- **Single-variant export resolves; library export stays raw.** In `src/exporters/importExport.ts`, `resumeJsonPayload` / `exportResumeAsJsonFile` run `resolveResume` so a single-variant file inlines bank wording and reads as a normal resume for Claude.ai (`link`/`hiddenBulletIds`/`bulletOrder` ride along as inert metadata; the `orphaned` UI flag is stripped). `libraryJsonPayload` / `exportLibraryAsJsonFile` keep the **raw** variants and carry `bank` — it's a backup, so inlining would defeat the point, and a library import must restore `bank` or every link dangles into a blank item. Design §4.7.

### The JSON artifact contract

`src/store/schema.ts` defines the canonical `Resume` shape with `zod`. This schema is **the contract with Claude.ai** — the user exports JSON, pastes it into Claude with a job posting, and re-imports Claude's modified JSON. The tailoring prompt and the rules that keep the round trip lossless live in [PROMPTS.md](./PROMPTS.md). When changing the schema:

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

`src/styles/resume.css` styles the `.page` element for both screen preview and print. The single `@media print` block lives in `src/styles/app.css` (resume.css has none) and hides everything except `.page` when printing — the print rules target the pane chrome (`.pane-bar`, `.pane-sidebar`, `.pane-editor`) by class, so if you rename pane wrapper classes, update the print media query too. PDF export is just `window.print()` — still the **only** print path, no PDF library, no Paged.js. This is intentional: the browser produces real text glyphs (ATS-parseable), embeds the font, and gives the best fidelity for the LaTeX-style look.

**Paged.js is parked, not forgotten** (design §4.6). It is a second full layout engine: it walks nodes one at a time calling `findBreakToken()` per append, its Polisher reparses CSS into an AST on every pass, it has a webfont-load timing dependency, and it has no incremental mode. Running it needs hundreds of milliseconds of debounce, which would lag exactly the trim-to-fit typing loop the page-fit indicator exists to serve — instant-and-approximate beats exact-and-laggy here. The page-fit badge measures with plain `offsetTop/offsetHeight` instead. Don't add Paged.js, and don't add a task for it.

**Every new pane/preview wrapper must be added to the `@media print` hide list.** When you wrap the page/preview in a new element, add it to the print block in `src/styles/app.css` or it will show up in the PDF — or clip the page, if it has `overflow: hidden` or a fixed height. Two patterns already there to copy: pure chrome gets `display: none !important` (that's `.pane-divider`, alongside `.pane-bar`/`.pane-sidebar`/`.pane-editor`/`.preview-toolbar`/`.toasts`); a wrapper that *contains* `.page` can't be hidden, so it's reset to a pass-through box instead — `.page-scaler` goes back to `display: block; height: auto !important`, `.page-scaled` gets `transform: none !important`, and the screen-only `.page-overflow-rule` guide is hidden. Those four were added to the print rules alongside the pane chrome; follow the same precedent.

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
