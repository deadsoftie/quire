import "./TopBar.css";

interface TopBarProps {
  projectLabel: string;
  /** `null` when unknown (the scratch/placeholder project never calls the
   * real `openProject`, so this is genuinely unavailable, not just
   * unchecked) -- the dot only ever renders on a real `false`. */
  engineAvailable: boolean | null;
}

// Section 7's layout: "36px, drag region" with "⌘K" at the left and
// "Project ◦" at the right -- no sidebar, no tab bar, no toolbar, and
// (deliberately, for now) no button here either: opening a project is
// reachable via Cmd/Ctrl+O until task 2.4 gives ⌘K a real palette to
// register that command into. The frameless-window drag-region part of
// "36px, drag region" is NOT implemented -- this is an in-content bar
// under the OS's own title bar, not a custom titlebar replacement; a
// deliberate scope cut for this task, not an oversight.
export function TopBar({ projectLabel, engineAvailable }: TopBarProps) {
  return (
    <header className="top-bar">
      <span className="top-bar__hint">⌘K</span>
      <span className="top-bar__project title">
        {projectLabel}
        {engineAvailable === false && (
          <span className="top-bar__dot" title="Tectonic engine not found" />
        )}
      </span>
    </header>
  );
}
