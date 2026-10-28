# Design Document

## Overview

Two independent, rendering-only features for the resume preview:

- **Feature A — Inline subheading + location cleanup.** `ItemBlock` (in `src/components/Preview/ResumePreview.tsx`) renders `heading` and `subheading` on one inline line joined by `" | "`, with the subheading taking the lighter/smaller location-style typography. The dead project-only location hack (`sectionTitle.toLowerCase().includes("project")`) is removed so `location` renders uniformly through `renderInline` for every section kind.
- **Feature B — `!!text!!` unbold token.** `renderInline` (in `src/utils/inlineMarkdown.tsx`) gains a fourth token, `!!text!!`, that emits a normal-weight `<span>` carrying a new CSS class. Existing `**bold**`, `*italic*`, and `[link](url)` behavior is preserved.

Scope is strictly rendering and parsing. No schema changes, no OAuth, no `dangerouslySetInnerHTML`. All author text continues to pass through React elements and plain strings, so HTML-significant characters render as literal text.

Language: TypeScript / React (TSX). Tests: Vitest + React Testing Library (already used in the repo).

## Architecture

```
Resume data ──► ItemBlock (ResumePreview.tsx)         Feature A: layout + wiring
                   │  heading, subheading             (one inline line, " | ")
                   │  location, dateRange, bullets
                   ▼
             renderInline (inlineMarkdown.tsx)         Feature B: tokenizer
                   │  single left-to-right regex
                   ▼
             React nodes (strings, <strong>, <em>,
             <a>, <span class="r-unbold">)
                   │
                   ▼
             resume.css                                styling (.r-unbold, inline header)
```

The two features touch disjoint seams: Feature A edits only the JSX/CSS of the header region; Feature B edits only the regex and node-emission of `renderInline`. They meet at the fact that `heading`, `subheading`, and `location` all pass through `renderInline`.

## Components and Interfaces

### 1. `ItemBlock` header rendering (Feature A)

Current markup places `heading` and `subheading` as two stacked children of `.r-item-headerL` (a `flex-direction: column` container) and branches `location` on the section title:

```tsx
<div className="r-item-headerL">
  {item.heading && <span className="r-heading">{renderInline(item.heading)}</span>}
  {item.subheading && (
    <span className="r-subheading">{renderInline(item.subheading)}</span>
  )}
</div>
<div className="r-item-headerR">
  {item.location &&
    (sectionTitle.toLowerCase().includes("project")
      ? <span className="r-location">{` | ${item.location}`}</span>
      : <span className="r-location">{renderInline(item.location)}</span>
    )}
  {item.dateRange && <span className="r-date">{renderInline(item.dateRange)}</span>}
</div>
```

#### Target markup

`.r-item-headerL` becomes a single inline line containing heading, an optional separator, and the subheading. The separator element only renders when **both** heading and subheading are non-empty, so there is never a dangling or leading `" | "`.

```tsx
<div className="r-item-headerL">
  {item.heading && (
    <span className="r-heading">{renderInline(item.heading)}</span>
  )}
  {item.heading && item.subheading && (
    <span className="r-heading-sep">{" | "}</span>
  )}
  {item.subheading && (
    <span className="r-subheading">{renderInline(item.subheading)}</span>
  )}
</div>
<div className="r-item-headerR">
  {item.location && (
    <span className="r-location">{renderInline(item.location)}</span>
  )}
  {item.dateRange && (
    <span className="r-date">{renderInline(item.dateRange)}</span>
  )}
</div>
```

Case analysis (satisfies R1.1–R1.3, R2.1–R2.4):

| `heading` | `subheading` | Rendered in `.r-item-headerL` |
| --- | --- | --- |
| non-empty | non-empty | `heading` + `" | "` + `subheading` (R1.1) |
| non-empty | empty | `heading` only, no separator (R1.2) |
| empty | non-empty | `subheading` only, no leading separator (R1.3) |
| empty | empty | nothing |

The separator is rendered as its own `<span className="r-heading-sep">` guarded by `item.heading && item.subheading`. This keeps the "no dangling separator" invariant structural (the separator node literally does not exist unless both sides exist) rather than relying on string concatenation.

`location` now always renders via `renderInline(item.location)` with no section-title inspection and no prepended pipe (R2.1, R2.2, R2.3). The empty-location guard (`item.location &&`) remains, so an empty location renders no element (R2.4). `sectionTitle` remains a prop of `ItemBlock` (other callers/signature unchanged) but is no longer read in the location branch; if no other usage remains it may be left in place to avoid churn.

### 2. `renderInline` tokenizer extension (Feature B)

#### Existing regex

```ts
const re = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
```

Alternatives, in left-to-right precedence (the `g` regex is scanned once; `exec` returns the leftmost match, and among alternatives starting at the same index the earliest-listed wins):

1. `\[([^\]]+)\]\(([^)]+)\)` → link, inner text in group 2, url in group 3
2. `\*\*([^*]+)\*\*` → bold, inner text in group 4
3. `\*([^*]+)\*` → italic, inner text in group 5

Ordering matters: `**` must be listed before `*` so a `**x**` run is consumed as bold rather than as two italic markers. The bold inner class `[^*]+` cannot contain `*`, which is the documented no-nested-same-token limitation.

#### Updated regex

Add the `!!` alternative. The inner class is `[^!]+` (inner text may not contain `!`), mirroring the `[^*]+` approach for `*`:

```ts
const re = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|!!([^!]+)!!)/g;
```

New alternative and capture group:

4. `!!([^!]+)!!` → unbold, inner text in **group 6**

Capture-group numbering (the outer group 1 is the whole match):

| Group | Belongs to | Holds |
| --- | --- | --- |
| 1 | whole alternation | entire matched token |
| 2 | link | link inner text |
| 3 | link | link url |
| 4 | bold | bold inner text |
| 5 | italic | italic inner text |
| 6 | unbold (new) | unbold inner text |

**Token precedence / why `!!` does not mis-match `**` or `*`:** the four alternatives use disjoint delimiter characters (`[`, `*`, `!`). The regex engine tries alternatives left-to-right at each position. `!!` shares no leading character with `[`, `**`, or `*`, so adding it as the last alternative cannot change how an existing `*`/`**`/`[` run is matched. Likewise `**`-before-`*` ordering is untouched. The only new precedence question is `!!` vs a literal `!`: a lone `!` (or an unmatched `!!`) never starts a successful alternative, so it is emitted as literal text by the `text.slice` fallback (satisfies R5.4). Because inner text is `[^!]+`, `!!!!` and nested same-token `!!` are not matched as a token (documented limitation, same shape as `**`).

#### Node emission

Branch selection currently keys off the first character(s) of the match: `m[0][0] === "["` (link) and `m[0][1] === "*"` (bold, i.e. `**`), else italic. Add an unbold branch keyed off the leading `!`:

```tsx
if (m[0][0] === "[") {
  const href = /^https?:\/\/|^mailto:|^\/\//.test(m[3]) ? m[3] : `https://${m[3]}`;
  nodes.push(
    <a key={i++} href={href} target="_blank" rel="noopener noreferrer">
      {m[2]}
    </a>
  );
} else if (m[0][0] === "!") {
  nodes.push(
    <span key={i++} className="r-unbold">{m[6]}</span>
  );
} else if (m[0][1] === "*") {
  nodes.push(<strong key={i++}>{m[4]}</strong>);
} else {
  nodes.push(<em key={i++}>{m[5]}</em>);
}
```

Branch discrimination by first character stays unambiguous because the four token kinds have distinct leading characters (`[`, `!`, `*`×2 vs `*`×1 disambiguated by the second char). The two leading and two trailing `!` are excluded because only `m[6]` (inner text) is rendered (R3.3). The function's existing guards are unchanged: falsy input returns `null` (R5.5); a single string node returns the bare string; otherwise a fragment. No `dangerouslySetInnerHTML` is introduced — every branch pushes a React element or a plain string, so React escapes HTML-significant characters as literal text (R5.2, R5.3).

The doc comment at the top of the file is updated to list the `!!text!!` token and to note the `[^!]+` no-nested-`!` limitation alongside the existing `*`/`**` note.

### 3. CSS additions (`src/styles/resume.css`)

Add the normal-weight class and make `.r-item-headerL` lay heading + separator + subheading on one inline line. The subheading reuses the location/date typography (italic today; the design keeps it visually aligned with `.r-location`/`.r-date`, which are the "lighter, smaller location-style" per R1.4).

```css
/* Inline header: heading | subheading on one line. */
.r-item-headerL {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0;              /* separator span supplies its own spaces */
}

.r-heading-sep {
  /* inherits body color; the literal " | " already carries its spaces */
}

/* Subheading uses the lighter/smaller location-style typography (R1.4). */
.r-subheading {
  font-style: italic;
  font-size: 0.95em;
}

/* Normal-weight token output (R3.1, R3.2). */
.r-unbold {
  font-weight: normal;
}
```

`.r-item-headerL` changes from `column` to `row` so heading and subheading share a line. `.r-item-headerR` is unchanged. `.r-unbold` is global under `.page` scope like the other resume classes, so it applies to the token wherever `renderInline` runs (heading, subheading, location, dateRange, bullets — R3.4).

## Data Models

No data-model changes. The `Item` fields consumed (`heading`, `subheading`, `location`, `dateRange`, `bullets[].text`) are existing optional strings. The feature is purely a function of these existing values.

## Error Handling

- **Empty / falsy field values.** `ItemBlock` guards each span with `item.<field> &&`; `renderInline` returns `null` on falsy input. Empty heading, subheading, or location render no element and no separator.
- **Unmatched `!!`.** A `!!` with no closing `!!` never matches an alternative; the characters fall through to the literal `text.slice` path and render as text (R5.4).
- **HTML-significant characters.** Author text containing `<`, `>`, `&`, quotes, etc. is passed as React children/attributes and escaped by React; no markup injection is possible (R5.3).
- **Malformed link url.** Existing behavior retained: a url lacking a recognized scheme is prefixed with `https://`.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Separator appears only between two non-empty sides

For any `heading` and `subheading` strings, the rendered `.r-item-headerL` contains the Heading_Separator `" | "` if and only if both `heading` and `subheading` are non-empty; when present it appears between the heading content and the subheading content, and the rendered line never begins with the separator.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Heading and subheading route through the inline renderer

For any `heading` or `subheading` containing a supported token, the rendered output contains that token's parsed element (not its literal delimiters), demonstrating both fields pass through the Inline_Markdown_Renderer.

**Validates: Requirements 1.5**

### Property 3: Location parses uniformly regardless of section kind

For any `location` string and any `sectionTitle` (including titles containing "project"), the rendered location content is the Inline_Markdown_Renderer output of that string, never prefixed with a pipe or the Heading_Separator, and is identical across all section titles.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 4: Unbold token yields a normal-weight element without delimiters

For any inner text containing no `!`, input `!!text!!` renders an element carrying the Normal_Weight_Class whose text content equals the inner text, with the two leading and two trailing `!` excluded from the output.

**Validates: Requirements 3.1, 3.3**

### Property 5: Token-free text is unchanged by the feature

For any input string containing no `!!` sequence, the Inline_Markdown_Renderer output is identical to its pre-feature output (including `**bold**`, `*italic*`, and `[text](url)` handling).

**Validates: Requirements 3.5**

### Property 6: Bold rendering

For any inner text containing no `*`, input `**text**` renders the inner text as bold.

**Validates: Requirements 4.1**

### Property 7: Italic rendering

For any inner text containing no `*`, input `*text*` renders the inner text as italic.

**Validates: Requirements 4.2**

### Property 8: Link rendering

For any inner text and url, input `[text](url)` renders the inner text inside a link whose destination resolves from the given url.

**Validates: Requirements 4.3**

### Property 9: Tokens in sequence parse independently

For any unbold token followed by a bold token in sequence (e.g. `!!a!!**b**`), the Inline_Markdown_Renderer renders each according to its own rule — a normal-weight element for the first and a bold element for the second.

**Validates: Requirements 4.4, 5.1**

### Property 10: HTML-significant characters render as literal text

For any input string containing HTML-significant characters inside or outside a token, those characters appear in the output as literal text content and no corresponding HTML element is injected.

**Validates: Requirements 5.2, 5.3**

## Testing Strategy

Dual approach: **property tests** (fast-check, ≥100 iterations each) for the universal behaviors above, and **example / edge-case tests** for specific scenarios and the explicit R6 test-presence requirements. Tests use Vitest + React Testing Library; render helpers serialize the component tree (`render(...).container.textContent` and `querySelector` for class checks).

Property test tag format: **Feature: resume-rich-text-formatting, Property {n}: {property text}**.

### Property-based tests (`src/utils/inlineMarkdown.property.test.tsx`, `src/components/Preview/itemHeader.property.test.tsx`)

- Property 1 — separator iff both sides non-empty (vary heading/subheading over `{empty, non-empty}` × arbitrary text).
- Property 2 — heading & subheading render parsed tokens.
- Property 3 — location output identical across arbitrary section titles incl. "project".
- Property 4 — `!!text!!` → `.r-unbold` with inner text, no `!`.
- Property 5 — token-free strings parse identically to a reference (bold/italic/link preserved).
- Properties 6–8 — bold / italic / link over arbitrary inner text and urls.
- Property 9 — `!!a!!**b**` yields `.r-unbold` then `<strong>`.
- Property 10 — strings with `<`, `>`, `&`, `<script>` render as literal text, no injected elements.

### Example / edge-case + R6 presence tests (`src/components/Preview/itemHeader.test.tsx`, `src/utils/inlineMarkdown.test.tsx`)

Mapped directly to Requirement 6 acceptance criteria:

- **R6.1** — non-empty heading + non-empty subheading render joined by `" | "` (assert `textContent` contains `heading | subheading`).
- **R6.2** — empty subheading renders no dangling `" | "` (assert `textContent` has no `|` and no `.r-heading-sep`).
- **R6.3** — location renders through `renderInline` regardless of section title (render with `sectionTitle="Projects"` and a neutral title; assert markup in location is parsed identically, and output never starts with `|`).
- **R6.4** — matched `!!x!!` renders inner text in a `.r-unbold` element and without `!!` delimiters.
- **R6.5** — `**bold**` → `<strong>`, `*italic*` → `<em>`, `[t](u)` → `<a href>` all still render after the token is added.
- **R6.6** — unmatched `!!` (e.g. `"a !! b"`) renders as literal text (`textContent` contains `!!`, no `.r-unbold`).

Additional edge cases: empty/falsy input → `null` (R5.5); empty `location` → no `.r-location` element (R2.4); CSS assertion that `.r-unbold` sets `font-weight: normal` (R3.2) via class-name check plus a stylesheet unit assertion.

Run with `npx vitest --run` (single execution, no watch mode).
