import { useLayoutEffect, useRef, useState, type Ref } from "react";
import type { Item, Resume, Section } from "../../store/schema";
import { useUiStore } from "../../store/uiStore";
import { renderInline } from "../../utils/inlineMarkdown";
import {
  PAGE_V_PADDING_PX,
  PAGE_WIDTH_PX,
  PRINTABLE_PX,
  computeScale,
  measureContentHeightPx,
  pageFit,
} from "./previewScale";

type Props = { resume: Resume };

/**
 * Where the printable box ends, in page coordinates (unscaled px from the top
 * of `.page`): the 0.5in top padding plus the 10in printable box = 1008px.
 * Derived from the same constants `pageFit` uses so the rule and the badge
 * cannot disagree about where the page break is.
 */
const OVERFLOW_RULE_TOP_PX = PAGE_V_PADDING_PX / 2 + PRINTABLE_PX;

function visibleSections(r: Resume): Section[] {
  return r.sections.filter((s) => !s.hidden);
}

function visibleItems(s: Section): Item[] {
  return s.items.filter((i) => !i.hidden);
}

function visibleBullets(i: Item) {
  return i.bullets.filter((b) => !b.hidden);
}

// Only "project" sections (title contains the substring, case-insensitive) use
// the inline `heading | subheading` layout; every other section keeps the
// original stacked subheading, hence `sectionTitle` is threaded through.
export function ItemBlock({ item, sectionTitle }: { item: Item, sectionTitle: string }) {
  const isProject = sectionTitle.toLowerCase().includes("project");
  const showHeader = !!(
    item.heading ||
    item.subheading ||
    item.location ||
    item.dateRange
  );
  const bullets = visibleBullets(item);
  return (
    <div className="r-item">
      {showHeader && (
        <div className="r-item-header">
          <div className={isProject ? "r-item-headerL r-item-headerL-inline" : "r-item-headerL"}>
            {item.heading && <span className="r-heading">{renderInline(item.heading)}</span>}
            {isProject && item.heading && item.subheading && (
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
            {item.dateRange && <span className="r-date">{renderInline(item.dateRange)}</span>}
          </div>
        </div>
      )}
      {bullets.length > 0 && (
        <ul className="r-bullets">
          {bullets.map((b) => (
            <li key={b.id}>{renderInline(b.text)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SkillRow({ item }: { item: Item }) {
  const bullet = visibleBullets(item)[0];
  if (!item.heading && !bullet) return null;
  return (
    <p className="r-skill-row">
      {item.heading && <span className="r-heading">{item.heading}: </span>}
      {bullet?.text ? renderInline(bullet.text) : null}
    </p>
  );
}

function SectionBlock({ section }: { section: Section }) {
  const items = visibleItems(section);
  if (items.length === 0 && !section.title) return null;
  return (
    <section className="r-section">
      <h2 className="r-section-title">{section.title}</h2>
      {section.kind === "skills"
        ? items.map((it) => <SkillRow key={it.id} item={it} />)
        : items.map((it) => <ItemBlock key={it.id} item={it} sectionTitle={section.title}/>)}
    </section>
  );
}

function ResumePage({ resume, pageRef }: Props & { pageRef?: Ref<HTMLElement> }) {
  const sections = visibleSections(resume);
  const fontClass =
    resume.font === "system-serif" ? "font-system-serif" : "font-latin-modern";
  const contactItems = (resume.header.fields ?? [])
    .filter((f) => !f.hidden)
    .map((f) => ({
      key: f.id,
      node: f.url
        ? <a href={f.url}>{f.label || f.url}</a>
        : <span>{f.label}</span>,
    }));

  return (
    <article ref={pageRef} className={`page ${fontClass}`}>
      <header className="r-header">
        <h1 className="r-name">{resume.header.fullName || "Your Name"}</h1>
        {contactItems.length > 0 && (
          <p className="r-contact">
            {contactItems.map((c, i) => (
              <span key={c.key}>
                {c.node}
                {i < contactItems.length - 1 && (
                  <span className="r-sep"> | </span>
                )}
              </span>
            ))}
          </p>
        )}
      </header>
      {sections.map((s) => (
        <SectionBlock key={s.id} section={s} />
      ))}
    </article>
  );
}

/**
 * The preview's scaler host (2.3, 2.4).
 *
 * `.page` itself stays at its literal 8.5in x 11in so what is on screen is what
 * prints; the scaling happens on the `.page-scaled` wrapper, which is where
 * 4.5's `.page-overflow-rule` will anchor as a *sibling* of `.page`. Structure
 * is fixed by design §4.6:
 *
 *     .page-scaler    ← the box the scaled page occupies in flow
 *       .page-scaled  ← position: relative; transform: scale(s), origin top center
 *         .page       ← untouched
 */
export function ResumePreview({ resume }: Props) {
  const scalerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);

  // 0 is the honest "not measured yet" value, and `computeScale` maps it to a
  // scale of 1 — see its docblock.
  const [availableWidthPx, setAvailableWidthPx] = useState(0);
  // `undefined` leaves the height at CSS `auto`, which is already correct at
  // scale 1, so the first paint is never wrong — only unscaled.
  const [scaledHeightPx, setScaledHeightPx] = useState<number | undefined>(undefined);

  // Written by the select in `App.tsx`'s `.preview-toolbar`, which is a sibling
  // subtree rather than a parent — hence the store rather than a prop (2.5).
  const zoom = useUiStore((s) => s.previewZoom);
  const scale = computeScale(zoom, availableWidthPx);

  // The dashed rule shows only while the page overflows (4.3). `null` means
  // "not measured yet", which is not an overflow.
  const overflowing = useUiStore((s) => s.pageFit?.fits === false);

  // Horizontal overflow has to be start-aligned, not centered (2.3).
  //
  // `.page-scaler` centers with `justify-content: center`, which centers the
  // *pre-transform* box; `transform-origin: top center` then keeps the painted
  // page centered in the pane. That is right at every fit scale, where the
  // painted page is exactly the pane width. At an explicit 50/75/100 that
  // overflows, it is wrong in a way scrolling cannot repair: the overflow is
  // symmetric, and overflow to the left of the scroll origin is unreachable, so
  // the left edge of the resume could not be read at all.
  //
  // Start alignment moves the whole overflow to the right, where it is
  // scrollable. The leftover: with the origin still centered, the painted page
  // begins `PAGE_WIDTH_PX * (1 - scale) / 2` in from the left, so an explicit
  // 50%/75% in a pane narrow enough to still overflow opens a gutter there. It
  // is dead space, not lost content, and it is exactly 0 at 100% — the zoom the
  // overflow case is actually for.
  const overflowsWidth =
    availableWidthPx > 0 && PAGE_WIDTH_PX * scale > availableWidthPx + 0.5;

  // Width only (2.4). Task 4.3 keeps this observer for pane-width changes and
  // measures page fit from its own layout effect, so resist the temptation to
  // read height here.
  //
  // The observed element is `.page-scaler` rather than `.pane-preview`: its
  // content box is already net of `.preview`'s padding and of any scrollbar
  // `overflow: auto` has taken, so the width that arrives is the width the
  // scaled page actually has to fit into. Measuring the pane would overstate it
  // by both and fit the page a little too large.
  useLayoutEffect(() => {
    const scaler = scalerRef.current;
    if (!scaler) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width;
      if (width === undefined) return;
      // Compare before setting. This observer watches the same element whose
      // height the effect below writes, so it fires on our own writes too;
      // bailing out on an unchanged width is what keeps that from looping.
      //
      // That closes the React loop but not the layout one: `.preview` is
      // `overflow: auto`, so a height write that drops the page below the
      // pane's height removes the vertical scrollbar, which widens this box,
      // which scales the page back up. There is a narrow band of pane sizes
      // where that is a 2-cycle (the browser caps it per frame, so it would
      // read as a flicker, not a hang). If it ever shows up, the fix is
      // `scrollbar-gutter: stable` on `.preview` so the gutter is reserved and
      // the width stops depending on our height — a CSS change, deliberately
      // not made here on a hazard that has not been observed.
      setAvailableWidthPx((prev) => (prev === width ? prev : width));
    });
    observer.observe(scaler);
    return () => observer.disconnect();
  }, []);

  // A transform is a paint-time operation: `.page-scaled` still occupies its
  // full pre-transform 8.5in x 11in in flow, so at a fit scale the pane would
  // scroll over a page-sized box of mostly empty space, and at 100% with
  // overflowing content it would clip. Giving `.page-scaler` the post-transform
  // height restores the scroll extent (2.4).
  //
  // `offsetHeight` is a layout value and ignores transforms, so it is the
  // unscaled page height and multiplying by the scale is the whole correction.
  // It is read after layout but before paint, hence the layout effect.
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const height = page.offsetHeight * scale;
    setScaledHeightPx((prev) => (prev === height ? prev : height));
  }, [resume, scale]);

  // Page-fit measurement (4.1, 4.2, 4.3).
  //
  // Triggered from a layout effect rather than from the `ResizeObserver` above:
  // `.page` is `min-height: 11in`, so its own box never shrinks below the floor
  // and an observer on it would not fire while content grows inside it (design
  // §3). `resume` changes identity on every edit, so keying on it is "measure
  // on every edit"; `font` changes the glyph metrics; `scale` is in the key as
  // specified, though the measurement itself is scale-independent because
  // `offsetTop`/`offsetHeight` ignore transforms. No debounce — a single
  // layout-value read is cheap and the trim-to-fit loop has to stay instant.
  //
  // Writes go through `setPageFit`, which compares by value before setting, so a
  // measurement that lands on the same number notifies nobody and cannot
  // re-trigger this effect.
  //
  // The first measurement can be taken with the fallback face while the webfont
  // is still loading, and its line breaks differ. One re-measure after
  // `document.fonts.ready` corrects that; it is inside this effect so a font
  // switch gets the same treatment, and `cancelled` stops a stale effect's
  // promise from writing after a newer one has run.
  const font = resume.font;
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const measure = () => {
      useUiStore.getState().setPageFit(pageFit(measureContentHeightPx(page)));
    };
    measure();

    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
    };
  }, [resume, font, scale]);

  return (
    <div
      className="page-scaler"
      ref={scalerRef}
      style={{
        height: scaledHeightPx,
        // `undefined` falls through to app.css's `center`.
        justifyContent: overflowsWidth ? "flex-start" : undefined,
      }}
    >
      <div className="page-scaled" style={{ transform: `scale(${scale})` }}>
        <ResumePage resume={resume} pageRef={pageRef} />
        {/* A SIBLING of `.page`, never a child (4.4): `measureContentHeightPx`
            reads `.page`'s last element child, and a child here would measure
            itself. Positioned in page coordinates inside `.page-scaled`, so it
            scales with the page. */}
        {overflowing && (
          <div
            className="page-overflow-rule"
            aria-hidden="true"
            style={{ top: OVERFLOW_RULE_TOP_PX }}
          />
        )}
      </div>
    </div>
  );
}
