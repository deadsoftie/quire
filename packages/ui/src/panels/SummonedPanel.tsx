import type { ReactNode } from "react";
import "./SummonedPanel.css";

interface SummonedPanelProps {
  title: string;
  /** A short, permanent descriptor of what this panel shows -- not an
   * empty-state message, shown whether or not there's content (e.g. the
   * file tree's "reachable from the root document, not a full directory
   * listing" caveat needs to be visible either way). */
  caption?: string;
  /** Docked in the sidebar (`app__sidebar`), a normal flex child that
   * stays in the layout -- vs. the default ephemeral overlay that slides
   * in over the editor and disappears on Escape/re-toggling. */
  pinned?: boolean;
  onTogglePin: () => void;
  children: ReactNode;
}

// The shared shell for all three of Section 7's summoned panels (file
// tree ⌘1, outline ⌘2, problems ⌘3) -- "they overlay or slide, then
// dismiss on Escape" -- plus the pin/unpin toggle every panel supports
// (added on top of Section 7's spec, per direct request): pinning
// promotes a panel from the ephemeral overlay into a permanent sidebar
// slot; unpinning demotes it back to closed (not back to "open as
// overlay" -- that would just be a confusing third state).
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
