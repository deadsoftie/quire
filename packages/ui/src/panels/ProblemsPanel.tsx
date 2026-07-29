import type { Diagnostic } from "@quire/client";
import "./ProblemsPanel.css";

interface ProblemsPanelProps {
  diagnostics: Diagnostic[];
}

// diagnostics is real but thin today: one raw entry on failure until M3.10's log-parsing lands.
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
