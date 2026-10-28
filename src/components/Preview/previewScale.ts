/**
 * The one place the preview's scale factor is computed (Requirement 2.6) and
 * the one place page-fit is decided (Requirement 4.8).
 *
 * No React, no component state. Everything here is a plain function over the
 * page geometry constants, so the scaler and the page-fit indicator cannot
 * disagree about how big a page is.
 *
 * One honest exception to "pure": `measureContentHeightPx` reads layout off a
 * DOM node, because that is the measurement. It is kept as a plain function
 * taking an `HTMLElement` — not a hook, not a ref callback — so the arithmetic
 * half (`pageFit`) stays a total function over numbers and the DOM half stays
 * swappable behind one call site (Requirement 4.8).
 */

/** CSS inch. 1in is exactly 96 CSS px, so all page geometry is integral. */
export const PX_PER_IN = 96;

/** `.page` is a hard `width: 8.5in`. */
export const PAGE_WIDTH_PX = 8.5 * PX_PER_IN; // 816

/** `.page` is `min-height: 11in`. */
export const PAGE_HEIGHT_PX = 11 * PX_PER_IN; // 1056

/** `.page` is `padding: 0.5in 0.6in`, so 0.5in top + 0.5in bottom. */
export const PAGE_V_PADDING_PX = 1 * PX_PER_IN; // 96

/** The printable box: 10in of content between the vertical paddings. */
export const PRINTABLE_PX = PAGE_HEIGHT_PX - PAGE_V_PADDING_PX; // 960

/** Zoom choices offered by the preview toolbar. `"fit"` is the default. */
export type Zoom = "fit" | 0.5 | 0.75 | 1;

/**
 * The scale factor to apply to `.page`.
 *
 * An explicit 50/75/100 choice is returned verbatim. `"fit"` scales the page
 * down to the available width but never above 1 (Requirement 2.2), so a wide
 * pane shows the page at full size rather than blowing it up.
 *
 * Total by construction: a width that is zero, negative or non-finite means the
 * pane has not been measured yet (a fresh `ResizeObserver` reports 0), and the
 * honest answer there is "do not scale" rather than a 0 or NaN transform that
 * would make the page vanish.
 *
 * @returns a finite number in `(0, 1]`
 */
export function computeScale(zoom: Zoom, availableWidthPx: number): number {
  if (zoom !== "fit") return zoom;
  if (!Number.isFinite(availableWidthPx) || availableWidthPx <= 0) return 1;
  const fit = Math.min(1, availableWidthPx / PAGE_WIDTH_PX);
  // Guards the degenerate tail: a subnormal width divides down to exactly 0.
  return fit > 0 ? fit : 1;
}

/**
 * Whether the measured content clears the 10in printable box, and by how much.
 *
 * The magnitude is carried in inches because that is the unit the badge speaks
 * (Requirements 4.2, 4.3): "0.8in to spare" / "Over by ~1.2in". Discriminating
 * on `fits` rather than exposing a signed delta means the badge cannot render
 * "over by -0.8in" by forgetting a sign.
 */
export type PageFit =
  | { fits: true; spareInches: number }
  | { fits: false; overInches: number };

/**
 * Compare a measured content height against the printable box (Requirement 4.1).
 *
 * Takes a number, not a DOM node (Requirement 4.8): a future exact-pagination
 * check swaps where the number comes from without touching this arithmetic or
 * anything that renders its result.
 *
 * Exactly 960px fits — a page filled to the last pixel of its printable box has
 * not overflowed. `spareInches` and `overInches` are therefore both `0` at the
 * boundary, on the `fits` branch.
 *
 * Total by construction: a non-finite or negative height is not a measurement,
 * it is a failed one, and the answer there is the same as for a page with no
 * content at all (see `measureContentHeightPx`) rather than a NaN leaking into
 * the badge. No layout engine produces those values.
 *
 * @param contentHeightPx laid-out content height in CSS px, unscaled
 */
export function pageFit(contentHeightPx: number): PageFit {
  const measured =
    Number.isFinite(contentHeightPx) && contentHeightPx > 0 ? contentHeightPx : 0;
  const delta = PRINTABLE_PX - measured;

  return delta >= 0
    ? { fits: true, spareInches: delta / PX_PER_IN }
    : { fits: false, overInches: -delta / PX_PER_IN };
}

/**
 * The badge's headline for a page-fit result (Requirements 4.2, 4.3).
 *
 * Lives beside `pageFit` so the copy and the arithmetic share one vocabulary
 * (inches, one decimal) and the wording is testable without rendering. The
 * "approximate to within about a line" caveat (4.5) is deliberately not in
 * here: it is the same for both branches, so the badge renders it once.
 *
 * Over-by is floored at 0.1in: a sliver of overflow rounds to "0.0in" at one
 * decimal, and "Over by ~0.0in" reads as a contradiction.
 */
export function pageFitLabel(fit: PageFit): string {
  if (fit.fits) return `Fits on 1 page — ${fit.spareInches.toFixed(1)}in to spare`;
  return `Over by ~${Math.max(0.1, fit.overInches).toFixed(1)}in`;
}

/**
 * Structural equality for two page-fit results, `null` (not measured yet)
 * included.
 *
 * Exists because the measurement is written from a `useLayoutEffect` into
 * `uiStore`, and `pageFit` returns a fresh object every call: without a
 * value-level comparison the write is always "new", the subtree that renders
 * the badge re-renders, and the effect writes again (design §4.6). Comparing
 * before setting is what makes that a no-op instead of a loop.
 *
 * Plain `===` on the magnitudes is safe here precisely because `pageFit` is
 * total: it coerces a failed measurement to 0 rather than returning NaN, so
 * there is no value in its range that compares unequal to itself. If that ever
 * changes, this function starts reporting "changed" forever and the loop comes
 * back — hence the coupling is spelled out rather than left to be rediscovered.
 */
export function pageFitEquals(a: PageFit | null, b: PageFit | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.fits && b.fits) return a.spareInches === b.spareInches;
  if (!a.fits && !b.fits) return a.overInches === b.overInches;
  return false;
}

/**
 * Measure how tall `.page`'s content actually is, in unscaled CSS px.
 *
 * Reads the bottom of the last element child rather than `.page`'s own
 * `scrollHeight`: `.page` is `min-height: 11in`, so `scrollHeight` can never
 * report less than 1056px and the "room to spare" branch of Requirement 4.2
 * would be unreachable.
 *
 * `offsetTop`/`offsetHeight` are layout values and ignore `transform: scale()`,
 * so the result needs no correction for the preview's zoom — only
 * `getBoundingClientRect()` would. This relies on `.page { position: relative }`
 * (set in `resume.css`) making the page the `offsetParent` of its children, and
 * on the overflow rule being a *sibling* of `.page` rather than a child
 * (Requirement 4.4) — a child would be the last element and would measure
 * itself.
 *
 * `offsetTop` is measured from the page's padding edge, so it already includes
 * the 0.5in top padding; subtracting it leaves the height of the content box,
 * which is what `PRINTABLE_PX` describes.
 *
 * @returns a non-negative finite px count; `0` for a page with no element
 *   children, or one whose last child reports no layout box (an SVG child, or a
 *   node measured before it is in the document)
 */
export function measureContentHeightPx(page: HTMLElement): number {
  const last = page.lastElementChild as HTMLElement | null;
  if (!last) return 0;

  const bottom = last.offsetTop + last.offsetHeight;
  if (!Number.isFinite(bottom)) return 0;

  return Math.max(0, bottom - PAGE_V_PADDING_PX / 2);
}
