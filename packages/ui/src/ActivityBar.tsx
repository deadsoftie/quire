import { AlertTriangle, Folder, ListTree, Package, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PanelKind } from "./panels/types";
import "./ActivityBar.css";

interface ActivityBarProps {
  active: PanelKind | null;
  onSelect: (kind: PanelKind) => void;
  problemCount: number;
}

const ITEMS: { kind: PanelKind; label: string; Icon: LucideIcon }[] = [
  { kind: "file-tree", label: "Explorer", Icon: Folder },
  { kind: "search", label: "Search", Icon: Search },
  { kind: "outline", label: "Outline", Icon: ListTree },
  { kind: "problems", label: "Problems", Icon: AlertTriangle },
  { kind: "packages", label: "Packages", Icon: Package },
];

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
          <Icon aria-hidden="true" strokeWidth={1.6} />
          {kind === "problems" && problemCount > 0 && (
            <span className="activity-bar__badge">{problemCount > 99 ? "99+" : problemCount}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
