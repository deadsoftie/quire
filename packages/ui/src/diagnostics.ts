import type { Text } from "@codemirror/state";
import type { Diagnostic as LintDiagnostic } from "@codemirror/lint";
import type { Diagnostic, Position } from "@quire/client";

function offsetAt(doc: Text, pos: Position): number | null {
  if (pos.line < 0 || pos.line >= doc.lines) return null;
  const line = doc.line(pos.line + 1);
  const column = Math.max(0, Math.min(pos.column, line.length));
  return line.from + column;
}

function renderMessage(message: string, hint: string): () => HTMLElement {
  return () => {
    const container = document.createElement("div");
    const messageEl = document.createElement("div");
    messageEl.className = "cm-diagnosticMessage";
    messageEl.textContent = message;
    const hintEl = document.createElement("div");
    hintEl.className = "cm-diagnosticHint";
    hintEl.textContent = hint;
    container.append(messageEl, hintEl);
    return container;
  };
}

/**
 * quire-core usually reports a point location (start === end), not a token span -- left as a
 * zero-width range rather than guessed-widened, since CM6 already renders that case with its own
 * dedicated (and more honest) point marker instead of an underline implying a span we don't have.
 * Diagnostics with no range at all (`range: null`, e.g. "rerun needed") are dropped here; they
 * still reach the user via the Problems panel and status bar count.
 */
export function toEditorDiagnostics(diagnostics: Diagnostic[], doc: Text): LintDiagnostic[] {
  const result: LintDiagnostic[] = [];
  for (const d of diagnostics) {
    if (!d.range) continue;
    const from = offsetAt(doc, d.range.start);
    if (from === null) continue;
    const to = offsetAt(doc, d.range.end);

    result.push({
      from,
      to: to !== null && to > from ? to : from,
      severity: d.severity,
      message: d.message,
      renderMessage: d.hint ? renderMessage(d.message, d.hint) : undefined,
    });
  }
  return result;
}
