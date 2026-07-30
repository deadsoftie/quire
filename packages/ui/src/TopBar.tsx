import { useCommandRegistry } from "./commands/CommandContext";
import "./TopBar.css";

interface TopBarProps {
  projectLabel: string;
}

export function TopBar({ projectLabel }: TopBarProps) {
  const { openPalette } = useCommandRegistry();
  return (
    <header className="top-bar">
      <button type="button" className="top-bar__hint" onClick={openPalette}>
        ⌘K
      </button>
      <span className="top-bar__project title">{projectLabel}</span>
    </header>
  );
}
