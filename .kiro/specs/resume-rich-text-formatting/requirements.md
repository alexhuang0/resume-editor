# Requirements Document

## Introduction

This feature adds two independent rich-text formatting capabilities to the resume editor's rendered preview, both scoped to the client-side Vite + React + TypeScript application with Vitest coverage.

Feature A renders the existing per-item `subheading` field inline with `heading`, joined by a separator, and retires a half-finished project-only location-inline hack currently living in `ResumePreview.tsx`.

Feature B extends the existing injection-safe inline markdown utility (`src/utils/inlineMarkdown.tsx`) with a new `!!text!!` token that renders normal-weight (unbolded) text, usable in every field that already runs through `renderInline`.

Both features operate purely on rendering and parsing. No data schema changes, no OAuth, and no raw-HTML rendering are in scope.

## Glossary

- **Preview_Renderer**: The React rendering path rooted at `ResumePreview` in `src/components/Preview/ResumePreview.tsx` that produces the on-screen and printable resume page.
- **Item_Header**: The header region of a resume item rendered by the `ItemBlock` component, containing `heading`, `subheading`, `location`, and `dateRange`.
- **Inline_Markdown_Renderer**: The `renderInline` function exported from `src/utils/inlineMarkdown.tsx`.
- **Heading_Separator**: The literal three-character string `" | "` (space, pipe, space) used to join `heading` and `subheading` inline.
- **Unbold_Token**: The inline markup token delimited by `!!` on both sides, written `!!text!!`, that marks its inner text for normal-weight rendering.
- **Normal_Weight_Class**: A CSS class that sets `font-weight: normal` for text produced by an Unbold_Token.
- **Subheading**: The existing optional `subheading` string field on a resume item.
- **Test_Suite**: The Vitest-based automated tests for this project.

## Requirements

### Requirement 1

**User Story:** As a resume author, I want a project's subheading to appear inline next to its heading, so that the project title and its qualifier read as a single line.

#### Acceptance Criteria

1. WHERE an Item_Header has a non-empty `heading` and a non-empty Subheading, THE Preview_Renderer SHALL render the `heading` content followed by the Heading_Separator followed by the Subheading content within a single inline line.
2. WHERE an Item_Header has a non-empty `heading` and an empty Subheading, THE Preview_Renderer SHALL render the `heading` content without the Heading_Separator and without the Subheading.
3. WHERE an Item_Header has an empty `heading` and a non-empty Subheading, THE Preview_Renderer SHALL render the Subheading content without a leading Heading_Separator.
4. THE Preview_Renderer SHALL apply the existing lighter, smaller location-style typography to the rendered Subheading content.
5. THE Preview_Renderer SHALL pass both `heading` and Subheading content through the Inline_Markdown_Renderer before display.

### Requirement 2

**User Story:** As a maintainer, I want the half-finished project-only location-inline behavior removed, so that location rendering is consistent across all section kinds.

#### Acceptance Criteria

1. THE Preview_Renderer SHALL render the `location` field of an Item_Header through the Inline_Markdown_Renderer for every section kind.
2. THE Preview_Renderer SHALL render the `location` field without inspecting whether the section title contains the word "project".
3. THE Preview_Renderer SHALL render the `location` field without prepending the Heading_Separator or any pipe character to the `location` content.
4. WHERE an Item_Header has an empty `location`, THE Preview_Renderer SHALL render no `location` element.

### Requirement 3

**User Story:** As a resume author, I want to mark inline text as normal weight using `!!text!!`, so that I can append an unbolded qualifier to an otherwise bold heading.

#### Acceptance Criteria

1. WHEN the Inline_Markdown_Renderer receives text containing a matched Unbold_Token, THE Inline_Markdown_Renderer SHALL render the token's inner text inside an element carrying the Normal_Weight_Class.
2. THE Normal_Weight_Class SHALL set the rendered text to normal font weight.
3. WHEN the Inline_Markdown_Renderer receives text containing an Unbold_Token, THE Inline_Markdown_Renderer SHALL exclude the two leading and two trailing `!` delimiter characters from the rendered output.
4. THE Inline_Markdown_Renderer SHALL produce the Unbold_Token result for input received from `heading`, `subheading`, `location`, `dateRange`, and bullet text fields.
5. WHEN the Inline_Markdown_Renderer receives text with no Unbold_Token, THE Inline_Markdown_Renderer SHALL render the text identically to its behavior before the Unbold_Token was added.

### Requirement 4

**User Story:** As a resume author, I want existing bold, italic, and link markup to keep working alongside the new token, so that adding unbold support does not regress my current formatting.

#### Acceptance Criteria

1. WHEN the Inline_Markdown_Renderer receives `**text**`, THE Inline_Markdown_Renderer SHALL render the inner text as bold.
2. WHEN the Inline_Markdown_Renderer receives `*text*`, THE Inline_Markdown_Renderer SHALL render the inner text as italic.
3. WHEN the Inline_Markdown_Renderer receives `[text](url)`, THE Inline_Markdown_Renderer SHALL render the inner text as a link to the given url.
4. WHEN the Inline_Markdown_Renderer receives text containing both an Unbold_Token and a `**text**` token in sequence, THE Inline_Markdown_Renderer SHALL render each token according to its own rule.

### Requirement 5

**User Story:** As a maintainer, I want token parsing to be deterministic and injection-safe, so that author input cannot inject executable markup.

#### Acceptance Criteria

1. THE Inline_Markdown_Renderer SHALL parse all supported tokens in a single, defined left-to-right precedence order.
2. THE Inline_Markdown_Renderer SHALL render all output through React elements and plain strings without using `dangerouslySetInnerHTML`.
3. WHEN the Inline_Markdown_Renderer receives text containing HTML-significant characters inside or outside a token, THE Inline_Markdown_Renderer SHALL render those characters as literal text content.
4. IF the Inline_Markdown_Renderer receives an unmatched `!!` delimiter with no closing `!!`, THEN THE Inline_Markdown_Renderer SHALL render the `!!` characters as literal text.
5. IF the Inline_Markdown_Renderer receives empty or null-equivalent input, THEN THE Inline_Markdown_Renderer SHALL return no rendered node.

### Requirement 6

**User Story:** As a maintainer, I want automated test coverage for both features, so that the formatting behavior is protected against regression.

#### Acceptance Criteria

1. THE Test_Suite SHALL include a Vitest test asserting that a non-empty `heading` and non-empty Subheading render joined by the Heading_Separator.
2. THE Test_Suite SHALL include a Vitest test asserting that an empty Subheading renders no dangling Heading_Separator.
3. THE Test_Suite SHALL include a Vitest test asserting that an Item_Header `location` renders through the Inline_Markdown_Renderer regardless of section title.
4. THE Test_Suite SHALL include a Vitest test asserting that a matched Unbold_Token renders inner text with the Normal_Weight_Class and without the `!!` delimiters.
5. THE Test_Suite SHALL include a Vitest test asserting that `**bold**`, `*italic*`, and `[text](url)` markup continue to render correctly after the Unbold_Token is added.
6. THE Test_Suite SHALL include a Vitest test asserting that an unmatched `!!` delimiter renders as literal text.
