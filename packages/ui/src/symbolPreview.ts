import katex from "katex";
import "katex/dist/katex.min.css";

// throwOnError: false renders KaTeX's own inline error text instead of throwing over one bad entry.
export function renderSymbolPreview(tex: string): HTMLElement {
  const container = document.createElement("div");
  container.className = "cm-symbolPreview";
  katex.render(tex, container, { throwOnError: false });
  return container;
}
