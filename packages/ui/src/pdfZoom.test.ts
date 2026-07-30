import { describe, expect, it } from "vitest";
import { MAX_ZOOM_PERCENT, MIN_ZOOM_PERCENT, resolveScale, stepZoomPercent } from "./pdfZoom";

describe("resolveScale", () => {
  it("fits a page's natural width exactly to the container width", () => {
    expect(resolveScale("fit-width", 600, 300)).toBe(2);
    expect(resolveScale("fit-width", 300, 600)).toBe(0.5);
  });

  it("falls back to scale 1 for a not-yet-measured container or page", () => {
    expect(resolveScale("fit-width", 0, 300)).toBe(1);
    expect(resolveScale("fit-width", 600, 0)).toBe(1);
  });

  it("converts a numeric zoom mode directly from a percentage", () => {
    expect(resolveScale(100, 600, 300)).toBe(1);
    expect(resolveScale(150, 600, 300)).toBe(1.5);
    expect(resolveScale(50, 600, 300)).toBe(0.5);
  });
});

describe("stepZoomPercent", () => {
  it("steps by 10 in either direction", () => {
    expect(stepZoomPercent(100, 1)).toBe(110);
    expect(stepZoomPercent(100, -1)).toBe(90);
  });

  it("rounds an odd current percent (e.g. from fit-width) to the nearest step first", () => {
    expect(stepZoomPercent(83, 1)).toBe(90);
    expect(stepZoomPercent(87, -1)).toBe(80);
  });

  it("clamps at the configured bounds", () => {
    expect(stepZoomPercent(MAX_ZOOM_PERCENT, 1)).toBe(MAX_ZOOM_PERCENT);
    expect(stepZoomPercent(MIN_ZOOM_PERCENT, -1)).toBe(MIN_ZOOM_PERCENT);
  });
});
