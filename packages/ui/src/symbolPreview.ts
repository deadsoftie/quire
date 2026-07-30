import katex from "katex";
import "katex/dist/katex.min.css";

// Task 3.8: `CompletionItem.symbolPreview` is TeX source (e.g. "\\alpha"), not markup -- KaTeX is
// the renderer, not the data source (that's crate::index::symbols, server-side). `throwOnError:
// false` renders KaTeX's own inline error text instead of throwing: the preview is best-effort
// popup content, not something that should ever crash the editor over one bad symbol entry.
export function renderSymbolPreview(tex: string): HTMLElement {
  const container = document.createElement("div");
  container.className = "cm-symbolPreview";
  katex.render(tex, container, { throwOnError: false });
  return container;
}
