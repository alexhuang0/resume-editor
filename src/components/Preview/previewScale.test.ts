import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  PAGE_HEIGHT_PX,
  PAGE_V_PADDING_PX,
  PAGE_WIDTH_PX,
  PRINTABLE_PX,
  PX_PER_IN,
  computeScale,
  measureContentHeightPx,
  pageFit,
  pageFitLabel,
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

/**
 * The narrowest pane width this suite treats as a real measurement.
 *
 * Browser layout is fixed-point, not real-valued: Blink rounds to 1/64 px
 * (`LayoutUnit`) and Gecko to 1/60 px (app units), so the smallest non-zero
 * width a `ResizeObserver` can ever report is ~0.0156px. 1e-3 sits a full order
 * of magnitude below that — generous for any engine — while staying ~300 orders
 * of magnitude above the region where the fit arithmetic underflows (see
 * `fitsWithin`). Anything smaller is not a narrow pane, it is an unmeasured one,
 * and `computeScale` deliberately answers 1 there; that branch is covered by the
 * `(0, 1]` property below and pinned by the unit tests.
 */
const MIN_MEASURABLE_PANE_PX = 1e-3;

/** The subset the "fits the pane" clause is about: a real, measured width. */
const measuredPaneWidthPx = fc.oneof(
  fc.double({ min: MIN_MEASURABLE_PANE_PX, max: Number.MAX_VALUE, noNaN: true }),
  fc.double({ min: 1, max: PAGE_WIDTH_PX, noNaN: true }),
  fc.double({ min: PAGE_WIDTH_PX, max: 1e9, noNaN: true }),
  fc.constantFrom(
    MIN_MEASURABLE_PANE_PX,
    1 / 64, // Blink's LayoutUnit granularity: the true narrowest measurement.
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
 *
 * Two roundings of relative size `EPSILON / 2` compose to at most `EPSILON`, so
 * `2 * EPSILON` is a real bound — but only while `w / 816` stays normal. Below
 * `816 * DBL_MIN` (~1.8e-305) the quotient is subnormal, gradual underflow eats
 * significand bits, and the relative error grows without limit; `w` itself is
 * then so tiny that `2 * EPSILON * w` is no slack at all. Hence the
 * `MIN_MEASURABLE_PANE_PX` floor on the generator above: that tail is a
 * limitation of this comparison, not scaling behaviour anyone can observe.
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

  it("stays in (0, 1] for widths too small for the fit ratio to survive", () => {
    // No layout engine reports these, but the ratio underflows here, so pin the
    // answer: a usable scale, never 0 or a denormal that makes the page vanish.
    for (const width of [1e-306, 7.923500685703174e-308, 5e-324]) {
      const scale = computeScale("fit", width);
      expect(scale).toBeGreaterThan(0);
      expect(scale).toBeLessThanOrEqual(1);
    }
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

/**
 * The only part of `.page` the measurement touches: its last element child's
 * `offsetTop`/`offsetHeight`. Faking it keeps this suite in the node
 * environment per the design's no-jsdom scope, and documents the whole contract
 * `measureContentHeightPx` depends on.
 */
function fakePage(last: Partial<HTMLElement> | null): HTMLElement {
  return { lastElementChild: last } as unknown as HTMLElement;
}

/** `.page`'s 0.5in top padding, which `offsetTop` includes. */
const PAD_TOP = PAGE_V_PADDING_PX / 2; // 48

describe("pageFit", () => {
  it("reports the spare room in inches when content fits", () => {
    // 960px box, 2in of content: 8in spare.
    expect(pageFit(2 * PX_PER_IN)).toEqual({ fits: true, spareInches: 8 });
    // The badge copy in task 4.4: "0.8in to spare". Fractional inches do not
    // survive a float round trip exactly, and the badge rounds to 1dp anyway.
    const spare = pageFit(PRINTABLE_PX - 0.8 * PX_PER_IN);
    expect(spare.fits).toBe(true);
    expect(spare.fits && spare.spareInches).toBeCloseTo(0.8, 10);
  });

  it("treats a page filled to exactly 960px as fitting, with zero spare", () => {
    expect(pageFit(PRINTABLE_PX)).toEqual({ fits: true, spareInches: 0 });
    expect(pageFit(PRINTABLE_PX + 1)).toEqual({
      fits: false,
      overInches: 1 / PX_PER_IN,
    });
  });

  it("reports the overflow in inches when content is over", () => {
    // The badge copy in task 4.4: "Over by ~1.2in".
    const over = pageFit(PRINTABLE_PX + 1.2 * PX_PER_IN);
    expect(over.fits).toBe(false);
    expect(!over.fits && over.overInches).toBeCloseTo(1.2, 10);
    // A full extra page.
    expect(pageFit(2 * PRINTABLE_PX)).toEqual({ fits: false, overInches: 10 });
  });

  it("reports a whole page spare for an empty or unmeasured page", () => {
    expect(pageFit(0)).toEqual({ fits: true, spareInches: 10 });
    expect(pageFit(-0)).toEqual({ fits: true, spareInches: 10 });
    // Not measurements, so answered the same as "nothing measured yet" rather
    // than leaking NaN into the badge.
    expect(pageFit(Number.NaN)).toEqual({ fits: true, spareInches: 10 });
    expect(pageFit(Number.POSITIVE_INFINITY)).toEqual({ fits: true, spareInches: 10 });
    expect(pageFit(-100)).toEqual({ fits: true, spareInches: 10 });
  });

  it("stays finite for an absurdly tall page", () => {
    const fit = pageFit(Number.MAX_VALUE);
    expect(fit.fits).toBe(false);
    expect(Number.isFinite(fit.fits ? fit.spareInches : fit.overInches)).toBe(true);
  });
});

/**
 * Content heights `measureContentHeightPx` can actually hand `pageFit`: finite
 * and non-negative. The boundary and the tails are pinned in by `constantFrom`
 * so every run set exercises them, not just the unlucky ones that shrink there.
 */
const contentHeightPx = fc.oneof(
  // Around and below the printable box, where the sign flips.
  fc.double({ min: 0, max: 2 * PRINTABLE_PX, noNaN: true }),
  // Whole and half pixels: what layout actually reports.
  fc.integer({ min: 0, max: 5 * PRINTABLE_PX }),
  // Very large, all the way to the top of the float range.
  fc.double({ min: 0, max: Number.MAX_VALUE, noNaN: true }),
  fc.constantFrom(
    0,
    -0,
    Number.MIN_VALUE,
    1,
    PRINTABLE_PX - 1,
    PRINTABLE_PX - Number.EPSILON * PRINTABLE_PX,
    PRINTABLE_PX,
    PRINTABLE_PX + Number.EPSILON * PRINTABLE_PX * 2,
    PRINTABLE_PX + 1,
    PAGE_HEIGHT_PX,
    1e6,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_VALUE,
  ),
);

/** Float slack for comparing two routes to the same inch count. */
function closeTo(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-12 + 1e-12 * Math.abs(expected);
}

/**
 * Feature: item-bank-and-editor-ux, Property 19: Page-fit arithmetic is sign-correct
 *
 * For any measured content height, the result reports fits exactly when the height
 * is at most 960px, and the reported inches equal `|height − 960| / 96` on the
 * matching branch.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */
describe("Property 19: page-fit arithmetic is sign-correct", () => {
  it("fits exactly when the height is at most 960px", () => {
    fc.assert(
      fc.property(contentHeightPx, (h) => {
        expect(pageFit(h).fits).toBe(h <= PRINTABLE_PX);
      }),
      { numRuns: 1000 },
    );
  });

  it("reports |height - 960| / 96 inches on the matching branch, never both", () => {
    fc.assert(
      fc.property(contentHeightPx, (h) => {
        const fit = pageFit(h);
        // Computed as inches-first so this is not the implementation restated.
        const expected = Math.abs(h / PX_PER_IN - PRINTABLE_PX / PX_PER_IN);

        if (fit.fits) {
          expect("overInches" in fit).toBe(false);
          expect(Number.isFinite(fit.spareInches)).toBe(true);
          expect(fit.spareInches).toBeGreaterThanOrEqual(0);
          expect(closeTo(fit.spareInches, expected)).toBe(true);
        } else {
          expect("spareInches" in fit).toBe(false);
          expect(Number.isFinite(fit.overInches)).toBe(true);
          expect(fit.overInches).toBeGreaterThan(0);
          expect(closeTo(fit.overInches, expected)).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("treats exactly 960px as fitting with zero spare", () => {
    fc.assert(
      fc.property(fc.constant(PRINTABLE_PX), (h) => {
        expect(pageFit(h)).toEqual({ fits: true, spareInches: 0 });
      }),
      { numRuns: 100 },
    );
  });

  it("flips branch across 960px: 960 - 1 fits, 960 + 1 does not, for every offset", () => {
    fc.assert(
      fc.property(fc.double({ min: 1e-6, max: PRINTABLE_PX, noNaN: true }), (d) => {
        const under = pageFit(PRINTABLE_PX - d);
        const over = pageFit(PRINTABLE_PX + d);

        expect(under.fits).toBe(true);
        expect(over.fits).toBe(false);
        // Equal distance either side of the line reports equal inches.
        expect(
          closeTo(
            under.fits ? under.spareInches : Number.NaN,
            over.fits ? Number.NaN : over.overInches,
          ),
        ).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("measureContentHeightPx", () => {
  it("measures to the bottom of the last child, minus the top padding", () => {
    // Last child runs from 48px (the padding edge) to 648px: 600px of content.
    expect(measureContentHeightPx(fakePage({ offsetTop: 648 - 200, offsetHeight: 200 })))
      .toBe(600);
  });

  it("can report less than the 11in min-height, unlike scrollHeight", () => {
    // The point of not reading .page's scrollHeight: this is the branch that
    // the min-height: 11in floor makes unreachable from .page itself.
    const px = measureContentHeightPx(fakePage({ offsetTop: PAD_TOP, offsetHeight: 500 }));
    expect(px).toBe(500);
    expect(px).toBeLessThan(PAGE_HEIGHT_PX);
    expect(pageFit(px)).toEqual({
      fits: true,
      spareInches: (PRINTABLE_PX - 500) / PX_PER_IN,
    });
  });

  it("returns 0 for a page with no element children", () => {
    expect(measureContentHeightPx(fakePage(null))).toBe(0);
    expect(measureContentHeightPx(fakePage(undefined as never))).toBe(0);
  });

  it("returns 0 for a last child that reports no layout box", () => {
    // An SVG child, or a node measured before it is in the document: the
    // offsets are undefined or NaN rather than numbers.
    expect(measureContentHeightPx(fakePage({}))).toBe(0);
    expect(measureContentHeightPx(fakePage({ offsetTop: Number.NaN, offsetHeight: 10 })))
      .toBe(0);
  });

  it("never reports a negative height", () => {
    expect(measureContentHeightPx(fakePage({ offsetTop: 0, offsetHeight: 0 }))).toBe(0);
  });
});

describe("pageFitLabel", () => {
  it("words the fits and over branches as the badge copy", () => {
    expect(pageFitLabel({ fits: true, spareInches: 0.8 })).toBe(
      "Fits on 1 page — 0.8in to spare"
    );
    expect(pageFitLabel({ fits: false, overInches: 1.2 })).toBe("Over by ~1.2in");
  });

  it("never reads 'Over by ~0.0in' for a sliver of overflow", () => {
    expect(pageFitLabel(pageFit(PRINTABLE_PX + 1))).toBe("Over by ~0.1in");
  });
});
