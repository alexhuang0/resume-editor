import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { renderInline } from "./inlineMarkdown";

/**
 * These tests exercise `renderInline` by rendering its React output to static
 * HTML with `react-dom/server` and asserting on the markup. The project's
 * Vitest environment is `node` (no jsdom), so `renderToStaticMarkup` is the
 * seam that lets us observe the real rendered tree — the elements React emits
 * and the way React escapes text — without a browser DOM. It also makes the
 * injection-safety property (Property 10) meaningful: if any author text leaked
 * through as raw markup, it would appear unescaped in this string.
 */
function html(text: string): string {
  return renderToStaticMarkup(<>{renderInline(text)}</>);
}

/**
 * The pre-feature reference renderer: `renderInline` exactly as it was before
 * the `!!text!!` unbold token (link / bold / italic only). Property 5 asserts
 * the feature left token-free text untouched, so the reference must be an
 * independent copy rather than a call back into the module under test.
 */
function renderInlineReference(text: string): import("react").ReactNode {
  if (!text) return null;
  const re = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  const nodes: import("react").ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[0][0] === "[") {
      const href = /^https?:\/\/|^mailto:|^\/\//.test(m[3]) ? m[3] : `https://${m[3]}`;
      nodes.push(
        <a key={i++} href={href} target="_blank" rel="noopener noreferrer">
          {m[2]}
        </a>,
      );
    } else if (m[0][1] === "*") {
      nodes.push(<strong key={i++}>{m[4]}</strong>);
    } else {
      nodes.push(<em key={i++}>{m[5]}</em>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  if (nodes.length === 0) return null;
  if (nodes.length === 1 && typeof nodes[0] === "string") return nodes[0];
  return <>{nodes}</>;
}

function referenceHtml(text: string): string {
  return renderToStaticMarkup(<>{renderInlineReference(text)}</>);
}

/**
 * How `renderToStaticMarkup` escapes text content, so expected substrings match
 * the emitted markup. React escapes `&`, `<`, `>`, and also `"`/`'` even in text
 * nodes, so all five are normalized here.
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
 * Inner text for an unbold token: any string with no `!` (the token's inner
 * class is `[^!]+`, so `!` would terminate the match) and non-empty (the class
 * requires at least one char). Excluding `!` keeps us inside the input space
 * the property is stated over.
 */
const unboldInner = fc
  .string({ minLength: 1 })
  .filter((s) => s.length > 0 && !s.includes("!"));

/** Inner text for a bold/italic token: non-empty, no `*`. */
const starInner = fc
  .string({ minLength: 1 })
  .filter((s) => s.length > 0 && !s.includes("*"));

/** Link inner text: non-empty, no `]` (would close the `[...]`). */
const linkText = fc
  .string({ minLength: 1 })
  .filter((s) => s.length > 0 && !s.includes("]"));

/** A url with a recognized scheme, so the href resolves to it verbatim. */
const schemeUrl = fc
  .webUrl()
  .filter((u) => /^https?:\/\//.test(u) && !u.includes(")") && !u.includes('"'));

/**
 * Token-free text for Property 5: no `!!` sequence anywhere. We still want
 * `**`, `*`, and `[...](...)` to appear, so the reference's link/bold/italic
 * paths are exercised. Generated from a palette of fragments, then rejected if
 * a `!!` slips in from adjacent `!` fragments.
 */
const tokenFreeText = fc
  .array(
    fc.oneof(
      fc.string(),
      fc.constantFrom(
        "plain",
        "**bold**",
        "*italic*",
        "[text](https://example.com)",
        "a ! b",
        "<tag>",
        "&amp;",
      ),
    ),
    { maxLength: 6 },
  )
  .map((parts) => parts.join(" "))
  .filter((s) => !s.includes("!!"));

describe("Feature: resume-rich-text-formatting, Property 4: Unbold token yields a normal-weight element without delimiters", () => {
  it("renders !!text!! as an .r-unbold element whose text is the inner text, no ! delimiters", () => {
    fc.assert(
      fc.property(unboldInner, (inner) => {
        const out = html(`!!${inner}!!`);
        // A span carrying the normal-weight class is emitted.
        expect(out).toContain('class="r-unbold"');
        // The inner text (React-escaped) is present...
        expect(out).toContain(esc(inner));
        // ...and the `!!` delimiters are gone from the rendered output.
        expect(out).not.toContain("!!");
      }),
      RUNS,
    );
  });
});

describe("Feature: resume-rich-text-formatting, Property 5: Token-free text is unchanged by the feature", () => {
  it("parses identically to the pre-feature reference, preserving bold/italic/link", () => {
    fc.assert(
      fc.property(tokenFreeText, (text) => {
        expect(html(text)).toBe(referenceHtml(text));
      }),
      RUNS,
    );
  });

  it("preserves explicit bold/italic/link markup verbatim against the reference", () => {
    fc.assert(
      fc.property(starInner, starInner, linkText, schemeUrl, (b, i, lt, url) => {
        const text = `**${b}** and *${i}* and [${lt}](${url})`;
        expect(html(text)).toBe(referenceHtml(text));
      }),
      RUNS,
    );
  });
});

describe("Feature: resume-rich-text-formatting, Property 6: Bold rendering", () => {
  it("renders **text** as a <strong> element containing the inner text", () => {
    fc.assert(
      fc.property(starInner, (inner) => {
        const out = html(`**${inner}**`);
        expect(out).toContain("<strong>");
        expect(out).toContain(esc(inner));
        expect(out).not.toContain("**");
      }),
      RUNS,
    );
  });
});

describe("Feature: resume-rich-text-formatting, Property 7: Italic rendering", () => {
  it("renders *text* as an <em> element containing the inner text", () => {
    fc.assert(
      fc.property(starInner, (inner) => {
        const out = html(`*${inner}*`);
        expect(out).toContain("<em>");
        expect(out).toContain(esc(inner));
      }),
      RUNS,
    );
  });
});

describe("Feature: resume-rich-text-formatting, Property 8: Link rendering", () => {
  it("renders [text](url) as a link to the url containing the inner text", () => {
    fc.assert(
      fc.property(linkText, schemeUrl, (text, url) => {
        const out = html(`[${text}](${url})`);
        // The anchor resolves to the given url (scheme already recognized).
        expect(out).toContain(`href="${esc(url)}"`);
        expect(out).toContain(esc(text));
        expect(out).toContain("<a ");
      }),
      RUNS,
    );
  });

  it("resolves a schemeless url by prefixing https://", () => {
    fc.assert(
      fc.property(
        linkText,
        fc
          .domain()
          .filter((d) => !d.includes(")") && !d.includes('"') && !d.includes("!")),
        (text, domain) => {
          const out = html(`[${text}](${domain})`);
          expect(out).toContain(`href="https://${esc(domain)}"`);
        },
      ),
      RUNS,
    );
  });
});

describe("Feature: resume-rich-text-formatting, Property 9: Tokens in sequence parse independently", () => {
  it("renders !!a!!**b** as an .r-unbold element followed by a <strong>", () => {
    // `b` excludes both `*` (bold inner class) and `!` so that the "no leftover
    // delimiters" assertions below are about the parser, not a `!`/`*` the
    // generator happened to put inside the token's own text.
    const boldInnerNoBang = starInner.filter((s) => !s.includes("!"));
    fc.assert(
      fc.property(unboldInner, boldInnerNoBang, (a, b) => {
        const out = html(`!!${a}!!**${b}**`);
        const unboldIdx = out.indexOf('class="r-unbold"');
        const strongIdx = out.indexOf("<strong>");
        expect(unboldIdx).toBeGreaterThanOrEqual(0);
        expect(strongIdx).toBeGreaterThanOrEqual(0);
        // The unbold span is rendered before the strong, each by its own rule.
        expect(unboldIdx).toBeLessThan(strongIdx);
        expect(out).not.toContain("!!");
        expect(out).not.toContain("**");
      }),
      RUNS,
    );
  });
});

describe("Feature: resume-rich-text-formatting, Property 10: HTML-significant characters render as literal text", () => {
  // Fragments that would form real markup if ever rendered unescaped.
  const dangerous = fc.constantFrom(
    "<script>",
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "a < b && c > d",
    "&",
    "&amp;",
    "</span>",
    '" onmouseover="x',
  );

  it("escapes HTML-significant characters outside a token", () => {
    fc.assert(
      fc.property(dangerous, (danger) => {
        const out = html(`before ${danger} after`);
        // No real element was injected by author text.
        expect(out.toLowerCase()).not.toContain("<script");
        expect(out.toLowerCase()).not.toContain("<img");
        // The raw `<` of the author text is escaped.
        if (danger.includes("<")) expect(out).toContain("&lt;");
        if (danger.includes(">")) expect(out).toContain("&gt;");
      }),
      RUNS,
    );
  });

  it("escapes HTML-significant characters inside an unbold token", () => {
    fc.assert(
      fc.property(
        dangerous.filter((d) => !d.includes("!")),
        (danger) => {
          const out = html(`!!${danger}!!`);
          // The token still produced its normal-weight span...
          expect(out).toContain('class="r-unbold"');
          // ...but the dangerous payload is escaped, not an element.
          expect(out.toLowerCase()).not.toContain("<script");
          expect(out.toLowerCase()).not.toContain("<img");
          if (danger.includes("<")) expect(out).toContain("&lt;");
        },
      ),
      RUNS,
    );
  });
});
