import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  PAGE_HEIGHT_PX,
  PAGE_V_PADDING_PX,
  PAGE_WIDTH_PX,
  PRINTABLE_PX,
  PX_PER_IN,
  computeScale,
  type Zoom,
} from "./previewScale";

const ZOOMS: Zoom[] = ["fit", 0.5, 0.75, 1];
const EXPLICIT_ZOOMS: Exclude<Zoom, "fit">[] = [0.5, 0.75, 1];

const zoom = fc.constantFrom(...ZOOMS);
const explicitZoom = fc.constantFrom(...EXPLICIT_ZOOMS);

/** Widths a `ResizeObserver` could plausibly hand us, plus the nasty tails. */
const paneWidthPx = fc.oneof(
  // Anything a 64-bit float can be — NaN and ±Infinity included by default.
  fc.double(),
  // Narrower than the page: the band where Fit actually does work.
  fc.double({ min: 1, max: PAGE_WIDTH_PX, noNaN: true }),
  // Far above the page width, where Fit has to clamp instead of blowing up.
  fc.double({ min: PAGE_WIDTH_PX, max: 1e9, noNaN: true }),
  // Zero and negative: a pane that has not been measured yet.
  fc.double({ min: -1e6, max: 0, noNaN: true }),
  fc.constantFrom(
    0,
    -0,
    -1,
    -PAGE_WIDTH_PX,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MIN_VALUE,
    -Number.MIN_VALUE,
    1,
    PAGE_WIDTH_PX - 1,
    PAGE_WIDTH_PX,
    PAGE_WIDTH_PX + 1,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_VALUE,
  ),
);

/** The subset the "fits the pane" clause is about: a real, measured width. */
const measuredPaneWidthPx = fc.oneof(
  fc.double({ min: Number.MIN_VALUE, max: Number.MAX_VALUE, noNaN: true }),
  fc.double({ min: 1, max: PAGE_WIDTH_PX, noNaN: true }),
  fc.double({ min: PAGE_WIDTH_PX, max: 1e9, noNaN: true }),
  fc.constantFrom(
    Number.MIN_VALUE,
    1,
    PAGE_WIDTH_PX - 1,
    PAGE_WIDTH_PX,
    PAGE_WIDTH_PX + 1,
    Number.MAX_VALUE,
  ),
);

/**
 * `816 * (w / 816)` can land an ULP or two above `w` — the quotient rounds, then
 * the product rounds again. Property 18 is a claim about pixels, not bit
 * patterns, so the comparison carries exactly that much slack and no more.
 */
function fitsWithin(scaledPx: number, availablePx: number): boolean {
  return scaledPx <= availablePx + 2 * Number.EPSILON * availablePx;
}

/**
 * Feature: item-bank-and-editor-ux, Property 18: Scale is bounded and fits the pane
 *
 * For any available pane width, including zero and non-finite values, the computed
 * scale is a finite number in `(0, 1]`; Fit never exceeds 1 and satisfies
 * `pageWidth * scale <= available` whenever the pane is narrower than the page; and
 * an explicit 50/75/100 choice is returned verbatim.
 *
 * **Validates: Requirements 2.1, 2.2, 2.4**
 */
describe("Property 18: scale is bounded and fits the pane", () => {
  it("returns a finite number in (0, 1] for every zoom and every width", () => {
    fc.assert(
      fc.property(zoom, paneWidthPx, (z, width) => {
        const scale = computeScale(z, width);

        expect(Number.isFinite(scale)).toBe(true);
        expect(scale).toBeGreaterThan(0);
        expect(scale).toBeLessThanOrEqual(1);
      }),
      { numRuns: 1000 },
    );
  });

  it("scales the page to fit a measured pane and never above 1", () => {
    fc.assert(
      fc.property(measuredPaneWidthPx, (width) => {
        // A subnormal width divides down to exactly 0, and no positive scale
        // fits a pane that narrow — `computeScale` falls back to 1 there, which
        // the (0, 1] clause above still covers.
        fc.pre(width / PAGE_WIDTH_PX > 0);

        const scale = computeScale("fit", width);

        expect(scale).toBeLessThanOrEqual(1);
        expect(fitsWithin(PAGE_WIDTH_PX * scale, width)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("returns an explicit 50/75/100 choice verbatim, whatever the width", () => {
    fc.assert(
      fc.property(explicitZoom, paneWidthPx, (z, width) => {
        expect(computeScale(z, width)).toBe(z);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("computeScale", () => {
  it("fits a pane narrower than the page by the exact ratio", () => {
    expect(computeScale("fit", PAGE_WIDTH_PX / 2)).toBe(0.5);
    expect(computeScale("fit", PAGE_WIDTH_PX)).toBe(1);
  });

  it("never scales up a pane wider than the page", () => {
    expect(computeScale("fit", PAGE_WIDTH_PX + 1)).toBe(1);
    expect(computeScale("fit", 4000)).toBe(1);
  });

  it("returns 1 for an unmeasured or nonsense width", () => {
    // A fresh ResizeObserver reports 0 before the first layout pass.
    expect(computeScale("fit", 0)).toBe(1);
    expect(computeScale("fit", -100)).toBe(1);
    expect(computeScale("fit", Number.NaN)).toBe(1);
    expect(computeScale("fit", Number.POSITIVE_INFINITY)).toBe(1);
    expect(computeScale("fit", Number.MIN_VALUE)).toBe(1);
  });
});

describe("page geometry", () => {
  it("matches the hard-coded .page box in resume.css", () => {
    expect(PX_PER_IN).toBe(96);
    expect(PAGE_WIDTH_PX).toBe(816); // 8.5in
    expect(PAGE_HEIGHT_PX).toBe(1056); // 11in
    expect(PAGE_V_PADDING_PX).toBe(96); // 0.5in top + 0.5in bottom
    expect(PRINTABLE_PX).toBe(960); // 10in of content
  });
});
