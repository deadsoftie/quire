// `Doc` is generic (not literally `PDFDocumentProxy`) so this is testable with plain tokens instead of mocking pdf.js.
export interface RenderDecisionInput<Doc> {
  /** What this page's *current* canvas element last painted, or `undefined` if never (a brand new element -- see PdfViewer's setCanvasRef). */
  lastRenderedDoc: Doc | undefined;
  /** The doc that was current immediately before `currentDoc`. */
  previousDoc: Doc | null;
  currentDoc: Doc;
  changedPages: ReadonlySet<number>;
  pageNumber: number;
}

// "Unchanged since last compile" is only sufficient to skip a redraw when the canvas demonstrably shows the *immediately preceding* compile's output; anything else has to render unconditionally.
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
