import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { autocompletion, snippet } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { redo as cmRedo, undo as cmUndo } from "@codemirror/commands";
import { linter, lintGutter, setDiagnostics as setLintDiagnostics } from "@codemirror/lint";
import type { Diagnostic } from "@quire/client";
import { useCommand } from "./commands/CommandContext";
import { toEditorDiagnostics } from "./diagnostics";
import {
  focusCompartment,
  focusModeExtension,
  proseCompartment,
  proseModeExtension,
  typewriterCompartment,
  typewriterScrollingExtension,
} from "./editorModes";
import { environmentSync } from "./environmentSync";
import { latex } from "./latex/language";
import { snippetCompletionSource } from "./snippets";
import { renderSymbolPreview } from "./symbolPreview";

export const INITIAL_SOURCE =
  "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

// Chromium normalizes most clipboard images -- including a macOS screenshot-to-clipboard, this
// feature's own acceptance case -- to `image/png` regardless of source, so `png` is the safe
// default; only an explicit JPEG source keeps its own extension, since Tectonic reads the image
// bytes by extension, not by sniffing content.
export function extensionForMimeType(mimeType: string): string {
  return mimeType === "image/jpeg" || mimeType === "image/jpg" ? "jpg" : "png";
}

// @codemirror/lint's own underline bakes a fixed color into the SVG itself (not `currentColor`),
// so recoloring it means supplying our own copy of that same SVG rather than a plain CSS override.
function underline(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3">' +
    '<path d="m0 2.5 l2 -1.5 l1 0 l2 1.5 l1 0" stroke="currentColor" fill="none" stroke-width=".7"/>' +
    "</svg>";
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
}

// `{ dark: true }` is more than a flag here: @codemirror/autocomplete's base theme gates its
// popup colors behind CM6's internal `&dark` scope class, which only gets added when some
// registered theme declares one -- without it the autocomplete popup gets no background at all.
const baseEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--ink-900)",
      color: "var(--type-hi)",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
    ".cm-content": {
      fontFamily: "var(--editor-font)",
      fontSize: "var(--editor-size)",
      lineHeight: "var(--editor-line-height)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--ink-900)",
      color: "var(--type-lo)",
      border: "none",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--ink-800)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--ink-800)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--nonrepro-dim)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--nonrepro)",
    },
    ".cm-tooltip": {
      border: "var(--seam) solid var(--ink-600)",
      backgroundColor: "var(--ink-800)",
      color: "var(--type-hi)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--nonrepro-dim)",
      color: "var(--nonrepro)",
    },
    ".cm-completionDetail": {
      color: "var(--type-mid)",
    },
    ".cm-completionMatchedText": {
      color: "var(--nonrepro)",
      textDecoration: "none",
      fontWeight: "600",
    },
    ".cm-symbolPreview": {
      padding: "10px 14px",
      fontSize: "1.6em",
      textAlign: "center",
    },
    // Errors red, warnings amber, nothing louder than that -- same two colors and 2px accent
    // width already used by StatusBar/ProblemsPanel.
    ".cm-diagnostic": {
      borderLeftWidth: "2px",
      padding: "6px 8px",
    },
    ".cm-diagnostic-error": { borderLeftColor: "var(--proof-red)" },
    ".cm-diagnostic-warning": { borderLeftColor: "var(--proof-amber)" },
    ".cm-diagnostic-info": { borderLeftColor: "var(--type-lo)" },
    ".cm-diagnosticText, .cm-diagnosticMessage": { color: "var(--type-hi)" },
    ".cm-diagnosticHint": { color: "var(--type-mid)", marginTop: "2px" },
    ".cm-lintRange-error": { color: "var(--proof-red)", backgroundImage: underline() },
    ".cm-lintRange-warning": { color: "var(--proof-amber)", backgroundImage: underline() },
    ".cm-lintRange-info": { color: "var(--type-lo)", backgroundImage: underline() },
    ".cm-lintPoint-error:after": { borderBottomColor: "var(--proof-red)" },
    ".cm-lintPoint-warning:after": { borderBottomColor: "var(--proof-amber)" },
    ".cm-lintPoint-info:after": { borderBottomColor: "var(--type-lo)" },
    // A quiet dot, not the library's default triangle/square/circle mix -- matches ProblemsPanel's
    // own restrained accent-only treatment rather than adding a third visual vocabulary.
    ".cm-lint-marker": {
      width: "0.5em",
      height: "0.5em",
      margin: "0.35em auto",
      borderRadius: "50%",
      content: "none",
    },
    ".cm-lint-marker-error": { backgroundColor: "var(--proof-red)" },
    ".cm-lint-marker-warning": { backgroundColor: "var(--proof-amber)" },
    ".cm-lint-marker-info": { backgroundColor: "var(--type-lo)" },
  },
  { dark: true },
);

function makeCompletionSource(projectId: string, uri: string) {
  return async function coreCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
    const argMatch = context.matchBefore(/\\(ref|eqref|autoref|cite|input|include|includegraphics)(\[[^\]]*\])?\{[^{}\n]*/);
    const wordMatch = context.matchBefore(/\\[a-zA-Z]*/);

    let from: number;
    if (argMatch) {
      from = argMatch.from + argMatch.text.indexOf("{") + 1;
    } else if (wordMatch && (wordMatch.from !== wordMatch.to || context.explicit)) {
      from = wordMatch.from + 1;
    } else {
      return null;
    }

    const line = context.state.doc.lineAt(context.pos);
    const items = await window.quire.complete({
      projectId,
      uri,
      position: { line: line.number - 1, column: context.pos - line.from },
      text: context.state.doc.toString(),
    });
    if (context.aborted || items.length === 0) return null;

    return {
      from,
      // sortPriority is ascending (lower = higher priority); CM6's own boost is the opposite
      // sense (higher = higher priority), hence the negation below.
      options: items.map((item) => ({
        label: item.label,
        detail: item.detail ?? undefined,
        apply: item.insert.includes("${") ? snippet(item.insert) : item.insert,
        boost: -item.sortPriority,
        info: item.symbolPreview ? () => renderSymbolPreview(item.symbolPreview!) : undefined,
      })),
    };
  };
}

interface EditorProps {
  initialDoc: string;
  projectId: string;
  uri: string;
  focusMode: boolean;
  typewriterMode: boolean;
  proseMode: boolean;
  restoreCursor?: number | null;
  // Applied a frame after mount so the content it scrolls has actually been laid out.
  restoreScrollTop?: number | null;
  onChange: (text: string) => void;
  // line/column here are 1-based (StatusBar's convention), distinct from the 0-based UTF-16
  // columns Position uses on the wire.
  onCursorActivity?: (cursor: number, scrollTop: number, line: number, column: number) => void;
  // Already filtered to this file's own uri -- Editor doesn't know about other open tabs.
  diagnostics?: Diagnostic[];
}

export function Editor({
  initialDoc,
  projectId,
  uri,
  focusMode,
  typewriterMode,
  proseMode,
  restoreCursor,
  restoreScrollTop,
  onChange,
  onCursorActivity,
  diagnostics,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorActivityRef = useRef(onCursorActivity);
  onCursorActivityRef.current = onCursorActivity;

  // No keybinding: basicSetup's own historyKeymap already handles ⌘Z/⇧⌘Z as a CM6-internal keymap
  // bound directly to the editor's contenteditable node. These commands exist purely so the
  // native Edit menu (which can't use role: "undo"/"redo" -- see apps/desktop/src/main.js) and the
  // command palette have something to dispatch into.
  useCommand({
    id: "editor.undo",
    title: "Undo",
    shortcut: "⌘Z",
    run: () => {
      if (viewRef.current) cmUndo(viewRef.current);
    },
  });
  useCommand({
    id: "editor.redo",
    title: "Redo",
    shortcut: "⇧⌘Z",
    run: () => {
      if (viewRef.current) cmRedo(viewRef.current);
    },
  });

  useEffect(() => {
    if (!hostRef.current) return;

    const cursor = Math.max(0, Math.min(restoreCursor ?? 0, initialDoc.length));

    const view = new EditorView({
      doc: initialDoc,
      selection: { anchor: cursor },
      extensions: [
        basicSetup,
        baseEditorTheme,
        latex(),
        environmentSync(),
        linter(null),
        lintGutter(),
        autocompletion({ override: [makeCompletionSource(projectId, uri), snippetCompletionSource] }),
        proseCompartment.of(proseMode ? proseModeExtension() : []),
        typewriterCompartment.of(typewriterMode ? typewriterScrollingExtension() : []),
        focusCompartment.of(focusMode ? focusModeExtension() : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.docChanged || update.selectionSet) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            onCursorActivityRef.current?.(head, update.view.scrollDOM.scrollTop, line.number, head - line.from + 1);
          }
        }),
        EditorView.domEventHandlers({
          scroll: (_event, editorView) => {
            const head = editorView.state.selection.main.head;
            const line = editorView.state.doc.lineAt(head);
            onCursorActivityRef.current?.(head, editorView.scrollDOM.scrollTop, line.number, head - line.from + 1);
          },
          // Task 4.7: only intercepts an actual image on the clipboard -- a normal text/file paste
          // falls through to CM6's own default handling untouched (returning false below).
          paste: (event, editorView) => {
            const item = Array.from(event.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
            if (!item) return false;

            event.preventDefault();
            const file = item.getAsFile();
            if (!file) return true;

            // Captured now, not read again once the async write resolves -- the user may have
            // moved the cursor or kept typing while the paste is still in flight.
            const { from, to } = editorView.state.selection.main;
            const extension = extensionForMimeType(item.type);

            file
              .arrayBuffer()
              .then((buffer) => window.quireDesktop.pasteImage(projectId, new Uint8Array(buffer), extension))
              .then((relativePath) => {
                editorView.dispatch({ changes: { from, to, insert: `\\includegraphics[width=0.8\\linewidth]{${relativePath}}` } });
              })
              .catch(() => {
                // Best-effort, matching 4.3's own "swallow and proceed" precedent for a failed
                // write -- nothing inserted rather than a broken image reference.
              });

            return true;
          },
        }),
      ],
      parent: hostRef.current,
    });
    viewRef.current = view;

    let restoreRafId: number | null = null;
    if (restoreScrollTop) {
      restoreRafId = requestAnimationFrame(() => {
        restoreRafId = null;
        view.scrollDOM.scrollTop = restoreScrollTop;
      });
    }

    return () => {
      if (restoreRafId !== null) cancelAnimationFrame(restoreRafId);
      view.destroy();
      viewRef.current = null;
    };
    // Props only seed the view on mount; the caller remounts (via `key`) to change them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: proseCompartment.reconfigure(proseMode ? proseModeExtension() : []) });
  }, [proseMode]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: typewriterCompartment.reconfigure(typewriterMode ? typewriterScrollingExtension() : []),
    });
  }, [typewriterMode]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: focusCompartment.reconfigure(focusMode ? focusModeExtension() : []) });
  }, [focusMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(setLintDiagnostics(view.state, toEditorDiagnostics(diagnostics ?? [], view.state.doc)));
  }, [diagnostics]);

  return <div ref={hostRef} style={{ height: "100%" }} />;
}
