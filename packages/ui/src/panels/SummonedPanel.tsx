import type { ReactNode } from "react";
import "./SummonedPanel.css";

interface SummonedPanelProps {
  title: string;
  /** A permanent descriptor, shown whether or not there's content -- not an empty-state message. */
  caption?: string;
  /** Docked in the sidebar vs. the default ephemeral overlay. */
  pinned?: boolean;
  onTogglePin: () => void;
  children: ReactNode;
}

// Shared shell for all three summoned panels (file tree ⌘1, outline ⌘2, problems ⌘3), plus the pin/unpin toggle.
export function SummonedPanel({ title, caption, pinned = false, onTogglePin, children }: SummonedPanelProps) {
  return (
    <div
      className={pinned ? "summoned-panel summoned-panel--pinned" : "summoned-panel surface"}
      role="region"
      aria-label={title}
    >
      <div className="summoned-panel__header">
        <div className="summoned-panel__heading">
          <span className="summoned-panel__title">{title}</span>
          {caption && <span className="summoned-panel__caption">{caption}</span>}
        </div>
        <button type="button" className="summoned-panel__pin" onClick={onTogglePin}>
          {pinned ? "Unpin" : "Pin"}
        </button>
      </div>
      <div className="summoned-panel__body">{children}</div>
    </div>
  );
}
