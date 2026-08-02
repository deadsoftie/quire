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
  /** `null` when no project is open -- the dot only renders on a real `false`. */
  engineAvailable: boolean | null;
  /** Plain-English, ready to display as-is. `null` once dismissed or nothing to report. */
  bundleVersionNotice: string | null;
  onDismissBundleVersionNotice: () => void;
}

export function StatusBar({
  problemCount,
  cursorPosition,
  engineAvailable,
  bundleVersionNotice,
  onDismissBundleVersionNotice,
}: StatusBarProps) {
  const position = useSyncExternalStore(cursorPosition.subscribe, cursorPosition.getSnapshot);

  return (
    <footer className="status-bar">
      <div className="status-bar__side">
        {problemCount > 0 && (
          <span className="status-bar__item status-bar__item--problem">
            {problemCount} {problemCount === 1 ? "problem" : "problems"}
          </span>
        )}
        {bundleVersionNotice && (
          <span className="status-bar__item status-bar__item--notice">
            {bundleVersionNotice}
            <button
              type="button"
              className="status-bar__dismiss"
              onClick={onDismissBundleVersionNotice}
              aria-label="Dismiss"
            >
              ×
            </button>
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
