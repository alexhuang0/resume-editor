/**
 * The one place the preview's scale factor is computed (Requirement 2.6).
 *
 * Pure module: no React, no DOM reads here. Task 4 adds `pageFit` and
 * `measureContentHeightPx` alongside these, so the page geometry constants stay
 * shared between the scaler and the page-fit indicator.
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
