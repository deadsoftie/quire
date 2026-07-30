import { useSyncExternalStore } from "react";
import "./StatusBar.css";

export interface CursorPosition {
  line: number;
  column: number;
}

/** Read side of `createCursorPositionStore` (App.tsx) -- see that function's own comment for why
 * this is a tiny external store instead of ordinary lifted state. */
export interface CursorPositionStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => CursorPosition | null;
}

interface StatusBarProps {
  problemCount: number;
  cursorPosition: CursorPositionStore;
  /** `null` when unknown (the scratch project never calls real `openProject`) -- the dot only renders on a real `false`. */
  engineAvailable: boolean | null;
}

// New in 3.5.4 (Section 7's layout revision). Problem count on the left; cursor position and the
// bundle/offline indicator on the right, moved here verbatim from TopBar -- same meaning, same
// dot, new location only.
export function StatusBar({ problemCount, cursorPosition, engineAvailable }: StatusBarProps) {
  const position = useSyncExternalStore(cursorPosition.subscribe, cursorPosition.getSnapshot);

  return (
    <footer className="status-bar">
      <div className="status-bar__side">
        {problemCount > 0 && (
          <span className="status-bar__item status-bar__item--problem">
            {problemCount} {problemCount === 1 ? "problem" : "problems"}
          </span>
        )}
      </div>
      <div className="status-bar__side">
        {position && (
          <span className="status-bar__item">
            Ln {position.line}, Col {position.column}
          </span>
        )}
        {engineAvailable === false && (
          <span className="status-bar__item" title="Tectonic engine not found">
            <span className="status-bar__dot" />
          </span>
        )}
      </div>
    </footer>
  );
}
