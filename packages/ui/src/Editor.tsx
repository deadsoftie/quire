import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { autocompletion, snippet } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { redo as cmRedo, undo as cmUndo } from "@codemirror/commands";
import { linter, lintGutter, setDiagnostics as setLintDiagnostics } from "@codemirror/lint";
import { search } from "@codemirror/search";
import type { Diagnostic } from "@quire/client";
import { useCommand } from "./commands/CommandContext";
import { toEditorDiagnostics } from "./diagnostics";
import {
  appearanceCompartment,
  appearanceExtension,
  focusCompartment,
  focusModeExtension,
  mathHighlightExtension,
  proseCompartment,
  proseModeExtension,
  typewriterCompartment,
  typewriterScrollingExtension,
  wordWrapCompartment,
} from "./editorModes";
import { environmentSync } from "./environmentSync";
import { neutralizeDefaultSearchKeymap } from "./findKeymap";
import { formatLatex } from "./latex/formatter";
import { latex } from "./latex/language";
import { snippetCompletionSource } from "./snippets";
import { SNIPPET_DRAG_MIME, snippetById } from "./snippetLibrary";
import { renderSymbolPreview } from "./symbolPreview";

// Chromium normalizes most clipboard images to `image/png` regardless of source; only explicit JPEG keeps its own extension.
export function extensionForMimeType(mimeType: string): string {
  return mimeType === "image/jpeg" || mimeType === "image/jpg" ? "jpg" : "png";
}

// Shared by the SnippetsPanel drop handler and its click/keyboard insertSnippet() path -- one insertion
// mechanism, not two. Routes through CM6's own snippet() apply function (line 161's `apply` field uses
// the same one) so ${1:tabstop} fields get real Tab-cycling, not a flat text insert.
function insertSnippetTemplate(view: EditorView, template: string, from: number, to: number) {
  snippet(template)(view, null, from, to);
}

// @codemirror/lint's own underline bakes a fixed color into the SVG, so recoloring needs our own copy, not a CSS override.
function underline(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3">' +
    '<path d="m0 2.5 l2 -1.5 l1 0 l2 1.5 l1 0" stroke="currentColor" fill="none" stroke-width=".7"/>' +
    "</svg>";
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
}

// No `{ dark }` flag here -- CodeMirror's darkTheme facet is `true` if *any* installed theme()
// extension declares it, with no way for a later `false` to override it. The actual flag lives
// solely in the appearanceCompartment below, reconfigured per the active theme's appearance.
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
    ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
      {
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
    // Errors red, warnings amber, same two colors and 2px accent width already used by StatusBar/ProblemsPanel.
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
    // A quiet dot, not the library's default triangle/square/circle mix -- matches ProblemsPanel's restraint.
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
      // sortPriority is ascending (lower wins); CM6's boost is the opposite sense, hence the negation below.
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
  appearance: "dark" | "light";
  focusMode: boolean;
  typewriterMode: boolean;
  proseMode: boolean;
  wordWrap: boolean;
  restoreCursor?: number | null;
  // Applied a frame after mount so the content it scrolls has actually been laid out.
  restoreScrollTop?: number | null;
  onChange: (text: string) => void;
  // line/column here are 1-based (StatusBar's convention), distinct from the wire's 0-based UTF-16 columns.
  onCursorActivity?: (cursor: number, scrollTop: number, line: number, column: number) => void;
  // Already filtered to this file's own uri -- Editor doesn't know about other open tabs.
  diagnostics?: Diagnostic[];
  /** ⌘F/⌥⌘F while the editor has focus -- see findKeymap.ts for why this can't just rely on the native menu accelerator. */
  onFindShortcut?: (withReplace: boolean) => void;
}

export interface EditorHandle {
  /** Replaces the whole document, e.g. for format-on-save -- a no-op if `newText` matches the current content. */
  replaceContent(newText: string): void;
  /** Moves the cursor to a 0-based line/column (clamped to the document), scrolls it into view, and focuses the editor. */
  revealPosition(line: number, column: number): void;
  /** SnippetsPanel's click/keyboard insert path -- inserts the named catalog entry at the current selection. */
  insertSnippet(id: string): void;
  /** Escape hatch for FindWidget to drive @codemirror/search's own functions directly against the live view. */
  getView(): EditorView | null;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    initialDoc,
    projectId,
    uri,
    appearance,
    focusMode,
    typewriterMode,
    proseMode,
    wordWrap,
    restoreCursor,
    restoreScrollTop,
    onChange,
    onCursorActivity,
    diagnostics,
    onFindShortcut,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorActivityRef = useRef(onCursorActivity);
  onCursorActivityRef.current = onCursorActivity;
  const onFindShortcutRef = useRef(onFindShortcut);
  onFindShortcutRef.current = onFindShortcut;

  // Shared by the manual "Format Document" command and the format-on-save imperative handle -- one dispatch helper, two entry points.
  function applyFormatted(newText?: string) {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const formatted = newText ?? formatLatex(current);
    if (formatted === current) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted } });
  }

  // line/column here are 0-based (the wire's Position convention), distinct from onCursorActivity's 1-based report.
  function revealPosition(line: number, column: number) {
    const view = viewRef.current;
    if (!view) return;
    const lineInfo = view.state.doc.line(Math.max(1, Math.min(line + 1, view.state.doc.lines)));
    const pos = Math.max(lineInfo.from, Math.min(lineInfo.from + column, lineInfo.to));
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    view.focus();
  }

  // The click/keyboard path for SnippetsPanel -- inserts at the current selection and focuses the
  // editor, sharing insertSnippetTemplate with the drop handler below rather than growing a second
  // insertion mechanism. Silently does nothing for an unknown id (e.g. a stale drag payload).
  function insertSnippet(id: string) {
    const view = viewRef.current;
    if (!view) return;
    const entry = snippetById(id);
    if (!entry) return;
    const { from, to } = view.state.selection.main;
    insertSnippetTemplate(view, entry.template, from, to);
    view.focus();
  }

  useImperativeHandle(
    ref,
    () => ({ replaceContent: applyFormatted, revealPosition, insertSnippet, getView: () => viewRef.current }),
    [],
  );

  // No keybinding: basicSetup's historyKeymap already binds ⌘Z/⇧⌘Z; these exist so the native Edit menu and palette have something to dispatch into.
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
  useCommand({
    id: "editor.format-document",
    title: "Format Document",
    shortcut: "⇧⌥F",
    // No keybinding: routed through the native Edit menu accelerator instead, same reason undo/redo are.
    run: () => applyFormatted(),
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
        mathHighlightExtension(),
        environmentSync(),
        // basicSetup only splices searchKeymap's bindings into its own keymap, not the search() extension
        // itself -- this installs the state field FindWidget drives, without ever mounting CM6's own panel.
        search(),
        neutralizeDefaultSearchKeymap((withReplace) => onFindShortcutRef.current?.(withReplace)),
        linter(null),
        lintGutter(),
        autocompletion({ override: [makeCompletionSource(projectId, uri), snippetCompletionSource] }),
        appearanceCompartment.of(appearanceExtension(appearance)),
        proseCompartment.of(proseMode ? proseModeExtension() : []),
        typewriterCompartment.of(typewriterMode ? typewriterScrollingExtension() : []),
        focusCompartment.of(focusMode ? focusModeExtension() : []),
        wordWrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
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
          // Only intercepts an actual image on the clipboard; a normal text/file paste falls through to CM6's default handling.
          paste: (event, editorView) => {
            const item = Array.from(event.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
            if (!item) return false;

            event.preventDefault();
            const file = item.getAsFile();
            if (!file) return true;

            // Captured now, not re-read once the async write resolves -- the cursor may have moved by then.
            const { from, to } = editorView.state.selection.main;
            const extension = extensionForMimeType(item.type);

            file
              .arrayBuffer()
              .then((buffer) => window.quireDesktop.pasteImage(projectId, new Uint8Array(buffer), extension))
              .then((relativePath) => {
                editorView.dispatch({ changes: { from, to, insert: `\\includegraphics[width=0.8\\linewidth]{${relativePath}}` } });
              })
              .catch(() => {
                // Best-effort: swallow a failed write -- nothing inserted rather than a broken image reference.
              });

            return true;
          },
          // Without this, the browser never allows a drop to fire at all.
          dragover: (event) => {
            if (event.dataTransfer?.types.includes(SNIPPET_DRAG_MIME)) event.preventDefault();
          },
          // Only intercepts a SnippetsPanel drag; any other drop (e.g. a file from the OS) falls through untouched.
          drop: (event, editorView) => {
            const id = event.dataTransfer?.getData(SNIPPET_DRAG_MIME);
            if (!id) return false;
            const entry = snippetById(id);
            if (!entry) return true;

            event.preventDefault();
            const pos = editorView.posAtCoords({ x: event.clientX, y: event.clientY }) ?? editorView.state.selection.main.head;
            insertSnippetTemplate(editorView, entry.template, pos, pos);
            editorView.focus();
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
    viewRef.current?.dispatch({ effects: appearanceCompartment.reconfigure(appearanceExtension(appearance)) });
  }, [appearance]);

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
    viewRef.current?.dispatch({ effects: wordWrapCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
  }, [wordWrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(setLintDiagnostics(view.state, toEditorDiagnostics(diagnostics ?? [], view.state.doc)));
  }, [diagnostics]);

  return <div ref={hostRef} style={{ height: "100%" }} />;
});
