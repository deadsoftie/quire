import { describe, expect, it } from "vitest";
import { shouldRenderPage } from "./pdfPageRender";

describe("shouldRenderPage", () => {
  it("renders a page that's never been rendered at all", () => {
    expect(
      shouldRenderPage({
        lastRenderedDoc: undefined,
        previousDoc: null,
        currentDoc: "D1",
        changedPages: new Set(),
        pageNumber: 1,
      }),
    ).toBe(true);
  });

  it("skips a page whose canvas already shows the current doc", () => {
    expect(
      shouldRenderPage({
        lastRenderedDoc: "D1",
        previousDoc: null,
        currentDoc: "D1",
        changedPages: new Set([1]),
        pageNumber: 1,
      }),
    ).toBe(false);
  });

  it("skips a page that was fresh as of the previous compile and isn't in changedPages", () => {
    expect(
      shouldRenderPage({
        lastRenderedDoc: "D1",
        previousDoc: "D1",
        currentDoc: "D2",
        changedPages: new Set([2]), // page 1 not in the list
        pageNumber: 1,
      }),
    ).toBe(false);
  });

  it("renders a page that was fresh as of the previous compile but is in changedPages", () => {
    expect(
      shouldRenderPage({
        lastRenderedDoc: "D1",
        previousDoc: "D1",
        currentDoc: "D2",
        changedPages: new Set([1]),
        pageNumber: 1,
      }),
    ).toBe(true);
  });

  it("renders unconditionally when the canvas is stale from further back than the immediately preceding compile", () => {
    // Painted for D1, but the doc has since moved through D2 to D3 --
    // D3's own changedPages (relative to D2) says nothing about whether
    // D1 -> D2 also left this page alone, so it can't be trusted.
    expect(
      shouldRenderPage({
        lastRenderedDoc: "D1",
        previousDoc: "D2",
        currentDoc: "D3",
        changedPages: new Set(), // D2 -> D3 changed nothing
        pageNumber: 5,
      }),
    ).toBe(true);
  });

  it("renders a brand new canvas element even for a doc it happens to already know about", () => {
    // Mirrors PdfViewer's setCanvasRef: a fresh DOM node never painted
    // anything, so `lastRenderedDoc` is undefined regardless of what
    // `currentDoc`/`previousDoc` are.
    expect(
      shouldRenderPage({
        lastRenderedDoc: undefined,
        previousDoc: "D1",
        currentDoc: "D1",
        changedPages: new Set(),
        pageNumber: 3,
      }),
    ).toBe(true);
  });
});
