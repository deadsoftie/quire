import type { ReactNode } from "react";
import "./PanelShell.css";

interface PanelShellProps {
  title: string;
  /** A permanent descriptor, shown whether or not there's content -- not an empty-state message. */
  caption?: string;
  /** Rendered top-right of the header, alongside the title -- e.g. Explorer's "+ New File" button. */
  action?: ReactNode;
  children: ReactNode;
}

export function PanelShell({ title, caption, action, children }: PanelShellProps) {
  return (
    <div className="panel-shell" role="region" aria-label={title}>
      <div className="panel-shell__header">
        <div className="panel-shell__header-row">
          <span className="panel-shell__title">{title}</span>
          {action}
        </div>
        {caption && <span className="panel-shell__caption">{caption}</span>}
      </div>
      <div className="panel-shell__body">{children}</div>
    </div>
  );
}
