import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import type { Item } from "../../store/schema";
import { ItemBlock } from "./ResumePreview";
import { renderInline } from "../../utils/inlineMarkdown";

/**
 * The project's Vitest environment is `node` (no jsdom, no React Testing
 * Library), so these tests render `ItemBlock` to a static HTML string with
 * `react-dom/server` and assert on the markup — the same seam tasks 1.2/1.3
 * used for `renderInline`. Serializing the real component tree lets us observe
 * the exact spans React emits (`.r-heading`, `.r-heading-sep`, `.r-subheading`,
 * `.r-location`) and the way React escapes author text, without a browser DOM.
 */

/** Build an `Item` with just the header fields the property varies. */
function makeItem(fields: Partial<Item>): Item {
  return { id: "it_test", bullets: [], ...fields };
}

/** Render an `ItemBlock` header to static HTML. */
function renderHeader(fields: Partial<Item>, sectionTitle = "Experience"): string {
  return renderToStaticMarkup(
    <ItemBlock item={makeItem(fields)} sectionTitle={sectionTitle} />,
  );
}

/** Render a bare `renderInline` call to static HTML, for comparison. */
function inlineHtml(text: string): string {
  return renderToStaticMarkup(<>{renderInline(text)}</>);
}

/**
 * How `renderToStaticMarkup` escapes text content, so expected substrings match
 * the emitted markup. React escapes `&`, `<`, `>`, `"`, and `'` in text nodes.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const RUNS = { numRuns: 200 };

/**
 * "Plain" field text with no formatting-significant characters: no `|` (so the
 * only pipe that can appear in the header comes from the `.r-heading-sep`
 * separator), and no markdown delimiters (`*`, `!`, `[`, `]`, `(`, `)`) so the
 * content survives `renderInline` as a literal string. This keeps Property 1's
 * separator reasoning unambiguous. Trailing/leading whitespace is trimmed off
 * the candidate because an all-whitespace string is non-empty but renders
 * invisibly; we additionally require a visible char.
 */
const plainText = fc
  .string({ minLength: 1 })
  .filter(
    (s) =>
      s.trim().length > 0 &&
      !/[|*!\[\]()]/.test(s),
  );

/** The two states Property 1 varies each side over. */
const sideState = fc.oneof(
  fc.constant<string | undefined>(undefined),
  plainText,
);

describe("Feature: resume-rich-text-formatting, Property 1: Separator appears only between two non-empty sides (project sections)", () => {
  it("renders the ' | ' separator iff both heading and subheading are non-empty, between them, never leading", () => {
    fc.assert(
      fc.property(sideState, sideState, (heading, subheading) => {
        // The inline separator layout is scoped to "project" sections, so the
        // separator property is asserted within one.
        const out = renderHeader({ heading, subheading }, "Projects");

        const bothPresent = !!heading && !!subheading;
        const hasSep = out.includes('class="r-heading-sep"');

        // Separator element exists iff both sides are non-empty.
        expect(hasSep).toBe(bothPresent);

        if (bothPresent) {
          // The literal " | " carries its own spaces inside the sep span.
          expect(out).toContain(">" + esc(" | ") + "<");

          const headIdx = out.indexOf(esc(heading as string));
          const sepIdx = out.indexOf('class="r-heading-sep"');
          const subIdx = out.lastIndexOf(esc(subheading as string));
          // Separator sits between the heading content and the subheading
          // content.
          expect(headIdx).toBeGreaterThanOrEqual(0);
          expect(headIdx).toBeLessThan(sepIdx);
          expect(sepIdx).toBeLessThan(subIdx);
        }

        // The rendered left column never begins with the separator: the first
        // header span is a heading or a subheading, never `.r-heading-sep`.
        const leftIdx = out.indexOf('class="r-item-headerL"');
        if (leftIdx >= 0) {
          const sepPos = out.indexOf('class="r-heading-sep"');
          const headPos = out.indexOf('class="r-heading"');
          const subPos = out.indexOf('class="r-subheading"');
          if (sepPos >= 0) {
            // Some content span precedes the separator span.
            const firstContent = [headPos, subPos]
              .filter((p) => p >= 0)
              .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
            expect(firstContent).toBeLessThan(sepPos);
          }
        }
      }),
      RUNS,
    );
  });
});

describe("Feature: resume-rich-text-formatting, Property 1b: Non-project sections never render the separator", () => {
  // Section titles that do NOT contain the substring "project" (case-insensitive).
  const nonProjectTitle = fc
    .string()
    .filter((s) => !s.toLowerCase().includes("project"));

  it("renders no .r-heading-sep and no inline modifier for any non-project section, regardless of both sides", () => {
    fc.assert(
      fc.property(sideState, sideState, nonProjectTitle, (heading, subheading, title) => {
        const out = renderHeader({ heading, subheading }, title);
        expect(out).not.toContain("r-heading-sep");
        expect(out).not.toContain("r-item-headerL-inline");
        // Both sides, when present, still render through their own spans.
        if (heading) expect(out).toContain('class="r-heading"');
        if (subheading) expect(out).toContain('class="r-subheading"');
      }),
      RUNS,
    );
  });
});

describe("Feature: resume-rich-text-formatting, Property 2: Heading and subheading route through the inline renderer", () => {
  // A supported token for each field, with its parsed-element signature and the
  // literal delimiters that must NOT survive.
  const token = fc.constantFrom(
    { make: (x: string) => `**${x}**`, marker: "<strong>", literal: "**" },
    { make: (x: string) => `*${x}*`, marker: "<em>", literal: "*" },
    { make: (x: string) => `!!${x}!!`, marker: 'class="r-unbold"', literal: "!!" },
  );
  // Inner text with no delimiter chars so the token parses cleanly and the
  // "literal delimiters gone" assertion is about the parser.
  const inner = fc
    .string({ minLength: 1 })
    .filter((s) => s.trim().length > 0 && !/[*!\[\]()]/.test(s));

  it("renders a supported token in heading as its parsed element, not literal delimiters", () => {
    fc.assert(
      fc.property(token, inner, (tok, text) => {
        const out = renderHeader({ heading: tok.make(text) });
        expect(out).toContain(tok.marker);
        expect(out).toContain(esc(text));
        expect(out).not.toContain(tok.literal);
      }),
      RUNS,
    );
  });

  it("renders a supported token in subheading as its parsed element, not literal delimiters", () => {
    fc.assert(
      fc.property(token, inner, (tok, text) => {
        const out = renderHeader({ subheading: tok.make(text) });
        expect(out).toContain(tok.marker);
        expect(out).toContain(esc(text));
        expect(out).not.toContain(tok.literal);
      }),
      RUNS,
    );
  });
});

describe("Feature: resume-rich-text-formatting, Property 3: Location parses uniformly regardless of section kind", () => {
  // Arbitrary location text that may carry a supported token, so this also
  // confirms location routes through renderInline.
  const locationText = fc.oneof(
    plainText,
    plainText.map((s) => `**${s.replace(/\*/g, "")}**`),
    plainText.map((s) => `!!${s.replace(/!/g, "")}!!`),
    plainText.map((s) => `[${s.replace(/[\]()]/g, "")}](https://example.com)`),
  );
  // Arbitrary section titles, deliberately including ones containing "project".
  const sectionTitle = fc.oneof(
    fc.constantFrom(
      "Experience",
      "Projects",
      "Side Projects",
      "project work",
      "A PROJECT",
      "Education",
      "",
    ),
    fc.string(),
  );

  it("renders location as renderInline(location), never pipe-prefixed, identical across section titles", () => {
    fc.assert(
      fc.property(locationText, sectionTitle, sectionTitle, (loc, titleA, titleB) => {
        const outA = renderHeader({ location: loc }, titleA);
        const outB = renderHeader({ location: loc }, titleB);

        // The location span is exactly `.r-location` wrapping
        // renderInline(location)'s markup — the field routes through the
        // inline renderer with nothing added. Matching the whole span (rather
        // than slicing to the first `</span>`) is robust to a location whose
        // own markup contains nested spans (e.g. an `!!...!!` unbold token).
        const expectedInner = inlineHtml(loc);
        const expectedSpan = `<span class="r-location">${expectedInner}</span>`;
        expect(outA).toContain(expectedSpan);

        // Section title (project or not) has no effect on the rendered
        // location: only the heading/subheading layout is section-dependent.
        // Compare the extracted `.r-location` span rather than whole markup.
        expect(outB).toContain(expectedSpan);

        // Never prefixed with a pipe or the heading separator: the inner markup
        // begins with whatever renderInline emitted, which for this input space
        // never starts with a pipe (location text excludes `|`, and no token
        // introduces one).
        expect(expectedInner.startsWith("|")).toBe(false);
        expect(expectedInner.startsWith(" | ")).toBe(false);
        expect(expectedInner).not.toContain(" | ");
      }),
      RUNS,
    );
  });
});
