import { describe, expect, it } from "vitest";
import { computeSplitFraction } from "./Seam";

describe("computeSplitFraction", () => {
  it("puts the boundary exactly where the cursor is, accounting for the seam's own width", () => {
    // 1000px-wide container, usable width is 992px (1000 - the 8px seam column) -- the fraction
    // that puts the seam's center at clientX 300 is (300 - 4) / 992, measurably different from
    // the pre-fix (seam-width-ignoring) 300 / 1000.
    const fraction = computeSplitFraction(300, 0, 1000)!;
    expect(fraction).toBeCloseTo((300 - 4) / 992, 5);
    expect(fraction).not.toBeCloseTo(300 / 1000, 4);
  });

  it("is unaffected by the container's own offset from the page", () => {
    const atOrigin = computeSplitFraction(500, 0, 1000)!;
    const offset = computeSplitFraction(700, 200, 1000)!;
    expect(offset).toBeCloseTo(atOrigin, 10);
  });

  it("clamps to leave at least MIN_PANE_PX on each side", () => {
    // Dragging to the far left/right should never let a pane collapse below the minimum.
    const left = computeSplitFraction(0, 0, 1000)!;
    const right = computeSplitFraction(1000, 0, 1000)!;
    expect(left).toBeGreaterThan(0);
    expect(right).toBeLessThan(1);
    expect(left + right).toBeCloseTo(1, 5); // symmetric clamp around the midpoint
  });

  it("returns null for a zero-width or seam-only container", () => {
    expect(computeSplitFraction(0, 0, 0)).toBeNull();
    expect(computeSplitFraction(0, 0, 8)).toBeNull();
  });

  it("returns exactly 0.5 for a centered drag on an even container", () => {
    // 8px seam centered in a 1008px container leaves 1000px usable, split evenly.
    expect(computeSplitFraction(504, 0, 1008)).toBeCloseTo(0.5, 10);
  });
});
