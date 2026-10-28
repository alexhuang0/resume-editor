import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemBlock } from "./ResumePreview";
import type { Item } from "../../store/schema";

/**
 * Example / edge-case + R6 presence tests for the `ItemBlock` header (task 4.3).
 *
 * The repo's test setup is deliberately DOM-free (see vitest.config.ts: node
 * environment, no jsdom, no React Testing Library). As the renderer tests
 * (task 1.3) do, these serialize `ItemBlock`'s React output to static HTML with
 * `react-dom/server` and assert against that string. There is no live DOM here,
 * so the "`textContent`" the requirements describe is read off the serialized
 * markup instead.
 */
function makeItem(overrides: Partial<Item>): Item {
  return {
    id: "it_test",
    bullets: [],
    ...overrides,
  };
}

function markup(item: Item, sectionTitle = ""): string {
  return renderToStaticMarkup(<ItemBlock item={item} sectionTitle={sectionTitle} />);
}

/** Strip tags to recover the visible text, approximating `.textContent`. */
function textContent(item: Item, sectionTitle = ""): string {
  return markup(item, sectionTitle).replace(/<[^>]*>/g, "");
}

describe("ItemBlock header — heading + subheading joined by separator in project sections (R6.1)", () => {
  it("joins a non-empty heading and non-empty subheading with ' | ' in a project section", () => {
    const item = makeItem({ heading: "Acme", subheading: "Lead Role" });
    const out = markup(item, "Projects");

    // The separator element is present...
    expect(out).toContain('class="r-heading-sep"');
    // ...and the visible text reads "heading | subheading".
    expect(textContent(item, "Projects")).toContain("Acme | Lead Role");
    // ...and the headerL uses the inline-row modifier.
    expect(out).toContain("r-item-headerL-inline");
  });

  it("matches the substring 'project' case-insensitively", () => {
    const item = makeItem({ heading: "Acme", subheading: "Lead Role" });
    for (const title of ["Projects", "SIDE PROJECTS", "Open-Source project work"]) {
      expect(markup(item, title)).toContain('class="r-heading-sep"');
    }
  });
});

describe("ItemBlock header — non-project sections keep the original stacked subheading", () => {
  it("renders no separator and stacks heading/subheading for a non-project section", () => {
    const item = makeItem({ heading: "Acme", subheading: "Lead Role" });
    const out = markup(item, "Experience");

    expect(out).not.toContain("r-heading-sep");
    expect(out).not.toContain("r-item-headerL-inline");
    // Both heading and subheading still render through their own spans.
    expect(out).toContain('class="r-heading"');
    expect(out).toContain('class="r-subheading"');
    expect(textContent(item, "Experience")).not.toContain("|");
  });

  it("stacks for an empty (default) section title", () => {
    const item = makeItem({ heading: "Acme", subheading: "Lead Role" });
    const out = markup(item);

    expect(out).not.toContain("r-heading-sep");
    expect(out).not.toContain("r-item-headerL-inline");
  });
});

describe("ItemBlock header — empty subheading leaves no dangling separator in project sections (R6.2)", () => {
  it("renders no ' | ' and no .r-heading-sep when subheading is empty", () => {
    const item = makeItem({ heading: "Acme", subheading: "" });
    const out = markup(item, "Projects");
    const text = textContent(item, "Projects");

    expect(out).not.toContain("r-heading-sep");
    expect(text).not.toContain("|");
    // Heading itself still renders.
    expect(text).toContain("Acme");
  });

  it("renders no separator when subheading is absent (undefined)", () => {
    const item = makeItem({ heading: "Acme" });

    expect(markup(item, "Projects")).not.toContain("r-heading-sep");
    expect(textContent(item, "Projects")).not.toContain("|");
  });
});

describe("ItemBlock header — location routes through renderInline regardless of section title (R6.3)", () => {
  it("parses location identically for a 'Projects' title and a neutral title", () => {
    const item = makeItem({ location: "**Remote**" });

    const projects = markup(item, "Projects");
    const neutral = markup(item, "Experience");

    // The location span renders identically across section titles — section
    // kind only affects the heading/subheading layout, never the location.
    const locationSpan = '<span class="r-location"><strong>Remote</strong></span>';
    expect(projects).toContain(locationSpan);
    expect(neutral).toContain(locationSpan);
    // location ran through renderInline: the ** token became a <strong>, not literal.
    expect(projects).toContain("<strong>Remote</strong>");
    expect(projects).not.toContain("**");
  });

  it("never prepends a pipe to the location content", () => {
    const item = makeItem({ location: "Remote" });
    const out = markup(item, "Projects");

    // Grab what's inside the .r-location span and confirm it doesn't start with a pipe.
    const match = out.match(/class="r-location">([^<]*)/);
    expect(match).not.toBeNull();
    expect(match?.[1]?.trimStart().startsWith("|")).toBe(false);
    expect(out).toContain('class="r-location">Remote');
  });
});

describe("ItemBlock header — edge cases", () => {
  it("renders a subheading with no leading separator when heading is empty, even in a project section (R1.3)", () => {
    const item = makeItem({ heading: "", subheading: "Lead Role" });
    const out = markup(item, "Projects");
    const text = textContent(item, "Projects");

    // No separator element and no leading pipe before the subheading.
    expect(out).not.toContain("r-heading-sep");
    expect(text).not.toContain("|");
    expect(text).toContain("Lead Role");
    // The subheading still renders through its own span.
    expect(out).toContain('class="r-subheading"');
  });

  it("renders no .r-location element when location is empty (R2.4)", () => {
    const item = makeItem({ heading: "Acme", location: "" });
    expect(markup(item)).not.toContain("r-location");
  });

  it("renders no .r-location element when location is absent (R2.4)", () => {
    const item = makeItem({ heading: "Acme" });
    expect(markup(item)).not.toContain("r-location");
  });
});
