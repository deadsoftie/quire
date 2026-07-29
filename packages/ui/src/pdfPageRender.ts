// Whether a page's canvas needs a fresh draw, given what it currently
// shows and what just changed. `Doc` is generic (rather than literally
// `PDFDocumentProxy`) so this is testable with plain tokens instead of
// mocking pdf.js -- the logic only ever depends on *identity* comparisons
// between doc references, never anything pdf.js-specific.
export interface RenderDecisionInput<Doc> {
  /** The doc this page's *current* canvas element last actually painted,
   * or `undefined` if it's never painted anything (a brand new element --
   * see PdfViewer's setCanvasRef -- or never rendered at all). */
  lastRenderedDoc: Doc | undefined;
  /** The doc that was current immediately before `currentDoc`. */
  previousDoc: Doc | null;
  currentDoc: Doc;
  /** `CompileResponse.changedPages` for the compile that produced
   * `currentDoc`. */
  changedPages: ReadonlySet<number>;
  pageNumber: number;
}

// `changedPages` only describes the delta from the *immediately
// preceding* compile to this one -- it says nothing about a page whose
// canvas is stale from two or more compiles ago (e.g. it was scrolled
// out of view and missed an edit in between). The only case where
// "unchanged since last compile" is actually sufficient to skip a
// redraw is when the canvas's current content demonstrably *is* last
// compile's output, i.e. `lastRenderedDoc === previousDoc`. Anything
// else (never rendered, or stale from further back) has to render
// unconditionally.
export function shouldRenderPage<Doc>({
  lastRenderedDoc,
  previousDoc,
  currentDoc,
  changedPages,
  pageNumber,
}: RenderDecisionInput<Doc>): boolean {
  if (lastRenderedDoc === currentDoc) return false;

  const wasFreshAsOfPreviousCompile = lastRenderedDoc === previousDoc;
  if (wasFreshAsOfPreviousCompile && !changedPages.has(pageNumber)) return false;

  return true;
}
