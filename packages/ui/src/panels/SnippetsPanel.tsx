import { useState } from "react";
import { SNIPPET_DRAG_MIME, categoryLabel, groupByCategory, searchSnippets } from "../snippetLibrary";
import type { SnippetEntry } from "../snippetLibrary";
import "./SnippetsPanel.css";

function previewLines(template: string): string {
  const lines = template.split("\n");
  const preview = lines.slice(0, 3).join("\n");
  return lines.length > 3 ? `${preview}\n…` : preview;
}

interface SnippetCardProps {
  snippet: SnippetEntry;
  onInsert: (id: string) => void;
}

// The real "Insert" button below is the card's only focusable/keyboard-activatable control -- the
// <li> itself just carries the drag payload (a mouse-only affordance) rather than doubling as a
// second, redundant button, which would leave keyboard/screen-reader users hitting two stops for
// one action.
function SnippetCard({ snippet, onInsert }: SnippetCardProps) {
  return (
    <li
      className="snippets-panel__item"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(SNIPPET_DRAG_MIME, snippet.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      <div className="snippets-panel__item-header">
        <span className="snippets-panel__label">{snippet.label}</span>
        <button
          type="button"
          className="snippets-panel__insert hit-target"
          onClick={() => onInsert(snippet.id)}
          aria-label={`Insert ${snippet.label}`}
          title="Insert at cursor"
        >
          Insert
        </button>
      </div>
      <p className="snippets-panel__description">
        {snippet.description}
        {snippet.requiresPackage && <span className="snippets-panel__requires"> · requires {snippet.requiresPackage}</span>}
      </p>
      <pre className="snippets-panel__preview">{previewLines(snippet.template)}</pre>
    </li>
  );
}

interface SnippetsPanelProps {
  /** Inserts at the active editor's current cursor position -- the click/keyboard path; dragging a card calls Editor's drop handler directly instead. */
  onInsert: (id: string) => void;
}

export function SnippetsPanel({ onInsert }: SnippetsPanelProps) {
  const [query, setQuery] = useState("");

  const filtered = searchSnippets(query);
  const groups = groupByCategory(filtered);

  return (
    <div className="snippets-panel">
      <input
        type="text"
        className="snippets-panel__search"
        placeholder="Search snippets…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {groups.length === 0 ? (
        <p className="panel-empty">No snippets match — try a different term.</p>
      ) : (
        <div className="snippets-panel__groups">
          {groups.map(({ category, items }) => (
            <div key={category} className="snippets-panel__group">
              <h3 className="snippets-panel__category">{categoryLabel(category)}</h3>
              <ul className="snippets-panel__list">
                {items.map((snippet) => (
                  <SnippetCard key={snippet.id} snippet={snippet} onInsert={onInsert} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
