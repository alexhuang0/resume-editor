import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type React from "react";
import { renderInline } from "./inlineMarkdown";

/**
 * Example / edge-case tests for `renderInline` (task 1.3).
 *
 * The repo's test setup is deliberately DOM-free (see vitest.config.ts: node
 * environment, no jsdom, no React Testing Library). Rather than pull a DOM in
 * for a pure tokenizer, these tests serialize the renderer's React output to
 * static HTML with `react-dom/server` and assert against that string — which
 * exposes exactly what the task checks (the `.r-unbold` element, the absence of
 * `!!` delimiters, `<strong>`/`<em>`/`<a href>` presence, literal fallthrough).
 */
function html(node: React.ReactNode): string {
  // `renderToStaticMarkup(null)` is "", matching the renderer's null return.
  return renderToStaticMarkup(<>{node}</>);
}

describe("renderInline — unbold token (R6.4)", () => {
  it("renders a matched !!x!! as a .r-unbold element without the !! delimiters", () => {
    const out = renderInline("!!Senior!!");
    const markup = html(out);

    // Inner text appears inside a normal-weight span...
    expect(markup).toContain('class="r-unbold"');
    expect(markup).toContain(">Senior<");
    // ...and the !! delimiters are gone from the rendered output.
    expect(markup).not.toContain("!!");
    expect(markup).not.toContain("!");
  });

  it("renders unbold tokens embedded in surrounding literal text", () => {
    const markup = html(renderInline("Role: !!Senior!! Engineer"));

    expect(markup).toContain("Role: ");
    expect(markup).toContain('<span class="r-unbold">Senior</span>');
    expect(markup).toContain(" Engineer");
    expect(markup).not.toContain("!!");
  });
});

describe("renderInline — existing tokens still render after !! is added (R6.5)", () => {
  it("renders **bold** as <strong>", () => {
    const markup = html(renderInline("**Lead**"));

    expect(markup).toContain("<strong>Lead</strong>");
    expect(markup).not.toContain("*");
  });

  it("renders *italic* as <em>", () => {
    const markup = html(renderInline("*nifty*"));

    expect(markup).toContain("<em>nifty</em>");
    expect(markup).not.toContain("*");
  });

  it("renders [text](url) as an <a href>", () => {
    const markup = html(renderInline("[site](https://example.com)"));

    expect(markup).toContain("href=\"https://example.com\"");
    expect(markup).toContain(">site</a>");
    // No raw markdown delimiters left behind.
    expect(markup).not.toContain("](");
  });

  it("renders a bold, italic, link, and unbold token together in one string", () => {
    const markup = html(
      renderInline("**b** *i* [t](https://x.io) !!u!!"),
    );

    expect(markup).toContain("<strong>b</strong>");
    expect(markup).toContain("<em>i</em>");
    expect(markup).toContain("href=\"https://x.io\"");
    expect(markup).toContain(">t</a>");
    expect(markup).toContain('<span class="r-unbold">u</span>');
  });
});

describe("renderInline — unmatched !! renders literally (R6.6)", () => {
  it("renders a lone middle !! as literal text with no .r-unbold element", () => {
    const markup = html(renderInline("a !! b"));

    expect(markup).toContain("!!");
    expect(markup).not.toContain("r-unbold");
  });

  it("renders a lone trailing !! literally (no closing delimiter)", () => {
    const markup = html(renderInline("done !!"));

    expect(markup).toContain("!!");
    expect(markup).not.toContain("r-unbold");
  });

  it("renders a single stray ! literally", () => {
    const markup = html(renderInline("wow!"));

    expect(markup).toContain("wow!");
    expect(markup).not.toContain("r-unbold");
  });
});

describe("renderInline — empty / falsy input returns no node (R5.5)", () => {
  it("returns null for an empty string", () => {
    expect(renderInline("")).toBeNull();
  });

  it("returns null for a null-equivalent (undefined-cast) input", () => {
    // Callers guard with `item.field &&`, but the renderer must still be safe
    // when handed a falsy value directly.
    expect(renderInline(undefined as unknown as string)).toBeNull();
    expect(renderInline(null as unknown as string)).toBeNull();
  });
});

describe("renderInline — HTML-significant characters stay literal (R5.4)", () => {
  it("escapes < > & rather than injecting markup", () => {
    const markup = html(renderInline("a < b & c > d"));

    // React escapes these; no real element is injected.
    expect(markup).toContain("&lt;");
    expect(markup).toContain("&gt;");
    expect(markup).toContain("&amp;");
  });

  it("renders a <script> as literal text, not an element", () => {
    const markup = html(renderInline("!!<script>alert(1)</script>!!"));

    expect(markup).toContain('class="r-unbold"');
    // The angle brackets are escaped, so no live <script> tag exists.
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });
});
