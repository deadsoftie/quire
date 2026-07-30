export type ZoomMode = "fit-width" | number;

export const MIN_ZOOM_PERCENT = 25;
export const MAX_ZOOM_PERCENT = 400;
const ZOOM_STEP_PERCENT = 10;

/**
 * The pdf.js viewport scale to render a page at, given the current zoom mode, the pane's
 * available content width, and that page's own natural width (its viewport at scale 1).
 * "fit-width" is resolved per page rather than globally, so a document with mixed page sizes
 * still fits each one to the pane.
 */
export function resolveScale(zoomMode: ZoomMode, containerWidth: number, pageNaturalWidth: number): number {
  if (zoomMode === "fit-width") {
    if (containerWidth <= 0 || pageNaturalWidth <= 0) return 1;
    return containerWidth / pageNaturalWidth;
  }
  return zoomMode / 100;
}

/** Rounds to the nearest step multiple first, so stepping away from a "fit-width"-derived percent
 * (which is rarely a clean multiple of the step) still lands on a normal-looking value. */
export function stepZoomPercent(currentPercent: number, direction: 1 | -1): number {
  const rounded = Math.round(currentPercent / ZOOM_STEP_PERCENT) * ZOOM_STEP_PERCENT;
  const stepped = rounded + direction * ZOOM_STEP_PERCENT;
  return Math.min(MAX_ZOOM_PERCENT, Math.max(MIN_ZOOM_PERCENT, stepped));
}
