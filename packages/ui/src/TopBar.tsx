import { useCommandRegistry } from "./commands/CommandContext";
import "./TopBar.css";

interface TopBarProps {
  projectLabel: string;
  /** `null` when unknown (the scratch/placeholder project never calls the
   * real `openProject`, so this is genuinely unavailable, not just
   * unchecked) -- the dot only ever renders on a real `false`. */
  engineAvailable: boolean | null;
}

// Section 7's layout: "36px, drag region" with "⌘K" at the left and
// "Project ◦" at the right -- no sidebar, no tab bar, no toolbar. The
// frameless-window drag-region part of "36px, drag region" is NOT
// implemented -- this is an in-content bar under the OS's own title bar,
// not a custom titlebar replacement; a deliberate scope cut from task
// 2.3, not an oversight.
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
