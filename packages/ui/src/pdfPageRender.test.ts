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
        changedPages: new Set([2]),
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
    expect(
      shouldRenderPage({
        lastRenderedDoc: "D1",
        previousDoc: "D2",
        currentDoc: "D3",
        changedPages: new Set(),
        pageNumber: 5,
      }),
    ).toBe(true);
  });

  it("renders a brand new canvas element even for a doc it happens to already know about", () => {
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
