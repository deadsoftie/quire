import type { ReactNode } from "react";
import "./PanelShell.css";

interface PanelShellProps {
  title: string;
  /** A permanent descriptor, shown whether or not there's content -- not an empty-state message. */
  caption?: string;
  children: ReactNode;
}

export function PanelShell({ title, caption, children }: PanelShellProps) {
  return (
    <div className="panel-shell" role="region" aria-label={title}>
      <div className="panel-shell__header">
        <span className="panel-shell__title">{title}</span>
        {caption && <span className="panel-shell__caption">{caption}</span>}
      </div>
      <div className="panel-shell__body">{children}</div>
    </div>
  );
}
