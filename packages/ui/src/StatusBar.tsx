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
  /** `null` when no project is open - the dot only renders on a real `false`. */
  engineAvailable: boolean | null;
  appVersion: string;
  /** Plain-English, ready to display as-is. `null` once dismissed or nothing to report. */
  bundleVersionNotice: string | null;
  onDismissBundleVersionNotice: () => void;
  /** True once a background-downloaded update is ready to install. */
  updateReady: boolean;
  onInstallUpdate: () => void;
  onDismissUpdateNotice: () => void;
}

export function StatusBar({
  problemCount,
  cursorPosition,
  engineAvailable,
  appVersion,
  bundleVersionNotice,
  onDismissBundleVersionNotice,
  updateReady,
  onInstallUpdate,
  onDismissUpdateNotice,
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
        {updateReady && (
          <span className="status-bar__item status-bar__item--notice">
            Update ready to install
            <button type="button" className="status-bar__action" onClick={onInstallUpdate}>
              Restart to update
            </button>
            <button
              type="button"
              className="status-bar__dismiss"
              onClick={onDismissUpdateNotice}
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
        <span className="status-bar__item">v{appVersion}</span>
      </div>
    </footer>
  );
}
