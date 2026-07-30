import { useCommandRegistry } from "./commands/CommandContext";
import "./TopBar.css";

interface TopBarProps {
  projectLabel: string;
}

// Not a frameless-window drag region (Section 7's "36px, drag region") -- an in-content bar under the OS title bar instead, a deliberate scope cut.
// The bundle/offline dot that used to live here moved to StatusBar (3.5.4) -- same meaning, new location only.
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
