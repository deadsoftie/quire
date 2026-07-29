import type { Diagnostic } from "@quire/client";
import "./ProblemsPanel.css";

interface ProblemsPanelProps {
  diagnostics: Diagnostic[];
}

// `CompileResponse.diagnostics` is real but thin today (CONTRACT.md):
// one raw, untranslated entry on a compile failure, `[]` otherwise --
// no per-line structured diagnostics until M3.10's log-parsing lands.
// This renders the real list either way, `hint`/`code` included, so
// nothing here needs to change when that data gets richer.
export function ProblemsPanel({ diagnostics }: ProblemsPanelProps) {
  if (diagnostics.length === 0) {
    return <p className="panel-empty">No problems.</p>;
  }

  return (
    <ul className="problems-panel">
      {diagnostics.map((diagnostic, index) => (
        <li key={index} className={`problems-panel__item problems-panel__item--${diagnostic.severity}`}>
          <span className="problems-panel__message">{diagnostic.message || diagnostic.rawMessage}</span>
          {diagnostic.hint && <span className="problems-panel__hint">{diagnostic.hint}</span>}
        </li>
      ))}
    </ul>
  );
}
