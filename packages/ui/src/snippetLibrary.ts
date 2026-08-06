import rawLibrary from "./data/snippet-library.json";

export type SnippetCategory =
  | "structure"
  | "math"
  | "figures-tables"
  | "lists"
  | "references"
  | "code"
  | "layout"
  | "beamer";

export interface SnippetEntry {
  id: string;
  category: SnippetCategory;
  label: string;
  description: string;
  tags: string[];
  /** CM6 tabstop syntax, e.g. "${1:foo}" -- same dialect as snippets.ts's inline completions. */
  template: string;
  /** Shown on the card, and also drives Editor.tsx's insertSnippetTemplate: it patches the preamble
   * (\usepackage, amsthm's \newtheorem, or a \documentclass switch for beamer) with this if missing. */
  requiresPackage?: string;
}

const LIBRARY = rawLibrary as SnippetEntry[];

/** Custom MIME type used for the SnippetsPanel drag payload -- deliberately not text/plain, so a stray
 * text drop from elsewhere (or dragging a card out to another app) can't be misread as a snippet id. */
export const SNIPPET_DRAG_MIME = "text/x-quire-snippet";

// Declaration order in the JSON, not alphabetical -- keeps related entries (e.g. theorem/lemma/definition) grouped as authored.
const CATEGORY_ORDER: SnippetCategory[] = [
  "structure",
  "math",
  "figures-tables",
  "lists",
  "references",
  "code",
  "layout",
  "beamer",
];

const CATEGORY_LABELS: Record<SnippetCategory, string> = {
  structure: "Structure & Front Matter",
  math: "Math",
  "figures-tables": "Figures & Tables",
  lists: "Lists",
  references: "References & Bibliography",
  code: "Code",
  layout: "Layout",
  beamer: "Beamer",
};

export function listSnippets(): SnippetEntry[] {
  return LIBRARY;
}

export function categoryLabel(category: SnippetCategory): string {
  return CATEGORY_LABELS[category];
}

export function listCategories(): SnippetCategory[] {
  const present = new Set(LIBRARY.map((s) => s.category));
  return CATEGORY_ORDER.filter((c) => present.has(c));
}

export function snippetById(id: string): SnippetEntry | undefined {
  return LIBRARY.find((s) => s.id === id);
}

// Case-insensitive substring match against label/description/tags -- same rigor as PackagesPanel's own client-side filter.
export function searchSnippets(query: string): SnippetEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return LIBRARY;
  return LIBRARY.filter(
    (s) =>
      s.label.toLowerCase().includes(trimmed) ||
      s.description.toLowerCase().includes(trimmed) ||
      s.tags.some((tag) => tag.toLowerCase().includes(trimmed)),
  );
}

export function groupByCategory(snippets: SnippetEntry[]): { category: SnippetCategory; items: SnippetEntry[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: snippets.filter((s) => s.category === category),
  })).filter((group) => group.items.length > 0);
}
