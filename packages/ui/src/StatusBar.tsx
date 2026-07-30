import { useSyncExternalStore } from "react";
import "./StatusBar.css";

export interface CursorPosition {
  line: number;
  column: number;
}

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
