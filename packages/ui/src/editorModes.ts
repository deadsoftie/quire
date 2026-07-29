import { Compartment, RangeSetBuilder } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

// One compartment per toggle, shared across Editor instances -- reconfiguring
// a compartment only ever affects whichever EditorView it's dispatched to.
export const proseCompartment = new Compartment();
export const typewriterCompartment = new Compartment();
export const focusCompartment = new Compartment();

export function proseModeExtension(): Extension {
  return EditorView.theme({
    ".cm-content": { fontFamily: "var(--prose-font)", fontSize: "var(--prose-size)" },
    ".cm-line": { lineHeight: "var(--prose-line-height)" },
  });
}

export function typewriterScrollingExtension(): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet) return;
    const view = update.view;
    const head = update.state.selection.main.head;
    // Deferred a frame so this dispatch isn't re-entrant with the update it's reacting to.
    requestAnimationFrame(() => {
      view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
    });
  });
}

// A paragraph is a run of lines with no blank line in between.
export function activeParagraphRange(state: EditorState): { from: number; to: number } {
  const doc = state.doc;
  const pos = state.selection.main.head;
  let startLine = doc.lineAt(pos).number;
  while (startLine > 1 && doc.line(startLine - 1).text.trim() !== "") startLine--;
  let endLine = doc.lineAt(pos).number;
  while (endLine < doc.lines && doc.line(endLine + 1).text.trim() !== "") endLine++;
  return { from: doc.line(startLine).from, to: doc.line(endLine).to };
}

const dimLine = Decoration.line({ class: "cm-focus-dim" });

function buildFocusDecorations(state: EditorState): DecorationSet {
  const { from, to } = activeParagraphRange(state);
  const builder = new RangeSetBuilder<Decoration>();
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (line.to < from || line.from > to) builder.add(line.from, line.from, dimLine);
  }
  return builder.finish();
}

const focusModePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildFocusDecorations(view.state);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) this.decorations = buildFocusDecorations(update.state);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const focusModeTheme = EditorView.theme({
  ".cm-focus-dim": { opacity: "0.35" },
});

export function focusModeExtension(): Extension {
  return [focusModePlugin, focusModeTheme];
}
