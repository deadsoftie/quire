import { Compartment, RangeSetBuilder } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

// One compartment per toggle, shared across Editor instances -- reconfiguring
// a compartment only ever affects whichever EditorView it's dispatched to.
export const proseCompartment = new Compartment();
export const typewriterCompartment = new Compartment();
export const focusCompartment = new Compartment();
export const wordWrapCompartment = new Compartment();

export function proseModeExtension(): Extension {
  return EditorView.theme({
    ".cm-content": { fontFamily: "var(--prose-font)", fontSize: "var(--prose-size)" },
    ".cm-line": { lineHeight: "var(--prose-line-height)" },
  });
}

// ViewPlugin (not a plain updateListener) so destroy() can cancel an in-flight rAF before it
// dispatches to an already-destroyed EditorView.
export function typewriterScrollingExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      private rafId: number | null = null;

      update(update: ViewUpdate) {
        if (!update.docChanged && !update.selectionSet) return;
        const view = update.view;
        const head = update.state.selection.main.head;
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        // Deferred a frame so this dispatch isn't re-entrant with the update it's reacting to.
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;
          view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) });
        });
      }

      destroy() {
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      }
    },
  );
}

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

const MATH_SPAN_NODE_NAMES = new Set([
  "InlineMath",
  "DisplayMathDollar",
  "DisplayMathBracket",
  "InlineMathParen",
  "MathEnvironment",
]);

// Exported and tested directly, same reasoning as `activeParagraphRange` above -- real coverage
// without needing a full EditorView.
export function mathHighlightSpans(state: EditorState): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!MATH_SPAN_NODE_NAMES.has(node.name)) return;
      spans.push({ from: node.from, to: node.to });
      return false; // math doesn't nest (module comment in latex.grammar) -- no need to descend
    },
  });
  return spans;
}

const mathRegionMark = Decoration.mark({ class: "cm-math-region" });

function buildMathDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of mathHighlightSpans(state)) {
    if (from < to) builder.add(from, to, mathRegionMark);
  }
  return builder.finish();
}

const mathHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildMathDecorations(view.state);
    }
    update(update: ViewUpdate) {
      // Unlike focus mode, math regions depend only on document content, never cursor position.
      if (update.docChanged) this.decorations = buildMathDecorations(update.state);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// Always on, unlike the compartmentalized toggles above -- a permanent readability aid, not an
// editing mode.
export function mathHighlightExtension(): Extension {
  return mathHighlightPlugin;
}
