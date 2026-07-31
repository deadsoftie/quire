import type { Diagnostic } from "@quire/client";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { basename } from "../paths";
import "./ProblemsPanel.css";

interface ProblemsPanelProps {
  diagnostics: Diagnostic[];
  onSelect: (diagnostic: Diagnostic) => void;
}

const SEVERITY_ICON: Record<Diagnostic["severity"], LucideIcon> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export function ProblemsPanel({ diagnostics, onSelect }: ProblemsPanelProps) {
  if (diagnostics.length === 0) {
    return <p className="panel-empty">No problems.</p>;
  }

  return (
    <ul className="problems-panel">
      {diagnostics.map((diagnostic, index) => {
        const Icon = SEVERITY_ICON[diagnostic.severity];
        const location = diagnostic.uri
          ? basename(diagnostic.uri) + (diagnostic.range ? `:${diagnostic.range.start.line + 1}` : "")
          : null;
        return (
          <li key={index} className={`problems-panel__item problems-panel__item--${diagnostic.severity}`}>
            <button
              type="button"
              className="problems-panel__button"
              disabled={!diagnostic.uri}
              onClick={() => onSelect(diagnostic)}
            >
              <Icon className="problems-panel__icon" aria-hidden="true" strokeWidth={1.8} />
              <span className="problems-panel__body">
                <span className="problems-panel__message">{diagnostic.message || diagnostic.rawMessage}</span>
                {diagnostic.hint && <span className="problems-panel__hint">{diagnostic.hint}</span>}
                {location && <span className="problems-panel__location">{location}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
