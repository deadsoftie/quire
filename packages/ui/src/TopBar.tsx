import { useCommandRegistry } from "./commands/CommandContext";
import "./TopBar.css";

interface TopBarProps {
  projectLabel: string;
  /** `null` when unknown (the scratch project never calls real `openProject`) -- the dot only renders on a real `false`. */
  engineAvailable: boolean | null;
}

// Not a frameless-window drag region (Section 7's "36px, drag region") -- an in-content bar under the OS title bar instead, a deliberate scope cut.
export function TopBar({ projectLabel, engineAvailable }: TopBarProps) {
  const { openPalette } = useCommandRegistry();
  return (
    <header className="top-bar">
      <button type="button" className="top-bar__hint" onClick={openPalette}>
        ⌘K
      </button>
      <span className="top-bar__project title">
        {projectLabel}
        {engineAvailable === false && (
          <span className="top-bar__dot" title="Tectonic engine not found" />
        )}
      </span>
    </header>
  );
}
