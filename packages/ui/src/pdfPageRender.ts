export interface RenderDecisionInput<Doc> {
  lastRenderedDoc: Doc | undefined;
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
