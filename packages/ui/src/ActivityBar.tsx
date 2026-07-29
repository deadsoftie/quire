import type { ComponentType } from "react";
import type { PanelKind } from "./panels/types";
import "./ActivityBar.css";

interface ActivityBarProps {
  active: PanelKind | null;
  onSelect: (kind: PanelKind) => void;
  problemCount: number;
}

function ExplorerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 6h6l2 2h8v10H4z" />
    </svg>
  );
}

function OutlineIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M5 6h14M5 12h9M5 18h11" />
    </svg>
  );
}

function ProblemsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 4 2 20h20z" />
      <path d="M12 10v4M12 16.5v.01" />
    </svg>
  );
}

function PackagesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M3 8 12 4l9 4-9 4-9-4Z" />
      <path d="M3 8v8l9 4 9-4V8M12 12v8" />
    </svg>
  );
}

const ITEMS: { kind: PanelKind; label: string; Icon: ComponentType }[] = [
  { kind: "file-tree", label: "Explorer", Icon: ExplorerIcon },
  { kind: "outline", label: "Outline", Icon: OutlineIcon },
  { kind: "problems", label: "Problems", Icon: ProblemsIcon },
  { kind: "packages", label: "Packages", Icon: PackagesIcon },
];

// Persistent, not summoned (Section 7) -- selects which section the sidebar shows.
// Clicking the already-active item collapses the sidebar; App.tsx owns that toggle.
export function ActivityBar({ active, onSelect, problemCount }: ActivityBarProps) {
  return (
    <nav className="activity-bar" aria-label="Sidebar sections">
      {ITEMS.map(({ kind, label, Icon }) => (
        <button
          key={kind}
          type="button"
          className={"activity-bar__item hit-target" + (active === kind ? " activity-bar__item--active" : "")}
          aria-label={label}
          aria-pressed={active === kind}
          title={label}
          onClick={() => onSelect(kind)}
        >
          <Icon />
          {kind === "problems" && problemCount > 0 && (
            <span className="activity-bar__badge">{problemCount > 99 ? "99+" : problemCount}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
