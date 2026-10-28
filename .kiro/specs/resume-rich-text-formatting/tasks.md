# Implementation Plan: resume-rich-text-formatting

## Overview

Two independent, rendering-only features for the resume preview, implemented in TypeScript/React (TSX) with Vitest + React Testing Library tests:

- **Feature B — `!!text!!` unbold token** in `renderInline` (`src/utils/inlineMarkdown.tsx`): a fourth regex alternative (group 6) emitting a normal-weight `<span class="r-unbold">`, with the doc comment updated.
- **Feature A — Inline subheading + location cleanup** in `ItemBlock` (`src/components/Preview/ResumePreview.tsx`): `heading` + optional `" | "` separator span + `subheading` on one inline line, and removal of the project-only location hack so `location` always runs through `renderInline`.
- **CSS** (`src/styles/resume.css`): `.r-unbold` normal weight, `.r-item-headerL` row layout, `.r-heading-sep`, subheading sizing.

The renderer (Feature B) is built and tested first because `heading`, `subheading`, and `location` all pass through it; the component wiring (Feature A) then relies on it. Run tests with `npx vitest --run` (single execution, no watch mode).

## Tasks

- [x] 1. Extend `renderInline` with the `!!text!!` unbold token
  - [x] 1.1 Add the `!!` regex alternative and unbold emission branch
    - In `src/utils/inlineMarkdown.tsx`, add `|!!([^!]+)!!` as the fourth alternative so the regex becomes `/(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|!!([^!]+)!!)/g`; inner unbold text is captured in group 6
    - Add an `else if (m[0][0] === "!")` branch that pushes `<span key={i++} className="r-unbold">{m[6]}</span>`, placed before the `**`/`*` branches so the leading-char discrimination stays unambiguous
    - Preserve existing link / bold / italic branches, the falsy-input `null` guard, the single-string return, and the fragment return; introduce no `dangerouslySetInnerHTML`
    - Update the file's doc comment to list the `!!text!!` token and note the `[^!]+` no-nested-`!` limitation alongside the existing `*`/`**` note
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.4, 5.5_

  - [x] 1.2 Write property tests for the inline renderer
    - Create `src/utils/inlineMarkdown.property.test.tsx` using fast-check (≥100 iterations each), tag format `Feature: resume-rich-text-formatting, Property {n}: ...`
    - **Property 4: Unbold token yields a normal-weight element without delimiters** — `!!text!!` (inner text with no `!`) renders a `.r-unbold` element whose text equals the inner text, no `!` delimiters
    - **Property 5: Token-free text is unchanged by the feature** — strings with no `!!` parse identically to the pre-feature reference, preserving `**bold**`/`*italic*`/`[text](url)`
    - **Property 6: Bold rendering** — `**text**` (inner text no `*`) renders bold
    - **Property 7: Italic rendering** — `*text*` (inner text no `*`) renders italic
    - **Property 8: Link rendering** — `[text](url)` renders inner text inside a link resolving to the url
    - **Property 9: Tokens in sequence parse independently** — `!!a!!**b**` renders a `.r-unbold` element then a `<strong>`
    - **Property 10: HTML-significant characters render as literal text** — strings with `<`, `>`, `&`, `<script>` inside/outside a token render as literal text with no injected element
    - **Validates: Requirements 3.1, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3**

  - [x] 1.3 Write example / edge-case tests for the inline renderer
    - Create `src/utils/inlineMarkdown.test.tsx`
    - R6.4 — matched `!!x!!` renders inner text in a `.r-unbold` element without `!!` delimiters
    - R6.5 — `**bold**` → `<strong>`, `*italic*` → `<em>`, `[t](u)` → `<a href>` all still render after the token is added
    - R6.6 — unmatched `!!` (e.g. `"a !! b"`) renders as literal text (`textContent` contains `!!`, no `.r-unbold`)
    - Edge cases: empty / null-equivalent input returns no node (`null`); a lone trailing `!!` renders literally
    - _Requirements: 3.3, 4.1, 4.2, 4.3, 5.4, 5.5, 6.4, 6.5, 6.6_

- [x] 2. Add CSS for the unbold token and inline header
  - In `src/styles/resume.css`, add `.r-unbold { font-weight: normal; }`
  - Change `.r-item-headerL` to row layout (`display: flex; flex-direction: row; align-items: baseline; flex-wrap: wrap; gap: 0;`) so heading + separator + subheading share one line
  - Add `.r-heading-sep` (literal `" | "` carries its own spaces) and give `.r-subheading` the lighter/smaller location-style typography (`font-style: italic; font-size: 0.95em;`)
  - _Requirements: 1.4, 3.1, 3.2, 3.4_

- [x] 3. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run`. Ensure all tests pass, ask the user if questions arise.

- [x] 4. Restructure the `ItemBlock` header and remove the location hack
  - [x] 4.1 Rewrite the `.r-item-headerL` / `.r-item-headerR` markup in `ResumePreview.tsx`
    - In `src/components/Preview/ResumePreview.tsx`, render inside `.r-item-headerL`: `{item.heading && <span className="r-heading">{renderInline(item.heading)}</span>}`, then `{item.heading && item.subheading && <span className="r-heading-sep">{" | "}</span>}`, then `{item.subheading && <span className="r-subheading">{renderInline(item.subheading)}</span>}` — the separator span exists only when both sides are non-empty (no dangling or leading `" | "`)
    - Replace the project-only location branch so `.r-item-headerR` renders `{item.location && <span className="r-location">{renderInline(item.location)}</span>}` with no `sectionTitle` inspection and no prepended pipe; keep the `item.location &&` empty-location guard and the existing `dateRange` span
    - Leave the `sectionTitle` prop/signature in place to avoid churn even though the location branch no longer reads it
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 2.3, 2.4_

  - [x] 4.2 Write property tests for the item header
    - Create `src/components/Preview/itemHeader.property.test.tsx` using fast-check (≥100 iterations each)
    - **Property 1: Separator appears only between two non-empty sides** — vary heading/subheading over `{empty, non-empty}` × arbitrary text; `.r-heading-sep` / `" | "` present iff both non-empty, between the two contents, line never begins with the separator
    - **Property 2: Heading and subheading route through the inline renderer** — a supported token in either field renders its parsed element, not its literal delimiters
    - **Property 3: Location parses uniformly regardless of section kind** — for arbitrary `location` and arbitrary `sectionTitle` (including titles containing "project"), rendered location equals `renderInline(location)` output, never pipe-prefixed, identical across section titles
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 2.3**

  - [x] 4.3 Write example / edge-case + R6 presence tests for the item header
    - Create `src/components/Preview/itemHeader.test.tsx`
    - R6.1 — non-empty heading + non-empty subheading render joined by `" | "` (`textContent` contains `heading | subheading`)
    - R6.2 — empty subheading renders no dangling `" | "` (no `|` in `textContent`, no `.r-heading-sep`)
    - R6.3 — location renders through `renderInline` regardless of section title (render with `sectionTitle="Projects"` and a neutral title; parsed identically, output never starts with `|`)
    - Edge cases: empty heading + non-empty subheading has no leading separator (R1.3); empty `location` renders no `.r-location` element (R2.4)
    - _Requirements: 1.3, 2.4, 6.1, 6.2, 6.3_

- [x] 5. Final checkpoint - Ensure all tests pass
  - Run `npx vitest --run`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (test sub-tasks) and can be skipped for a faster MVP; core implementation sub-tasks (1.1, 2, 4.1) are never optional.
- The renderer (task 1) and its tests precede the component wiring (task 4) because `heading`, `subheading`, and `location` all pass through `renderInline`.
- Each task references specific requirement clauses for traceability.
- Property tests validate the universal correctness properties (1–10); example/edge-case tests cover the explicit R6 presence requirements.
- Run tests with `npx vitest --run` (single execution, no watch mode).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3"] }
  ]
}
```
