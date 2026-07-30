import { useState } from "react";
import "./TabBar.css";

interface TabBarTab {
  uri: string;
  label: string;
  dirty: boolean;
}

interface TabBarProps {
  tabs: TabBarTab[];
  activeUri: string | null;
  onActivate: (uri: string) => void;
  /** Discards the buffer -- called directly for a clean tab, or after "Discard" on a dirty one. */
  onClose: (uri: string) => void;
  onSaveAndClose: (uri: string) => void;
}

export function TabBar({ tabs, activeUri, onActivate, onClose, onSaveAndClose }: TabBarProps) {
  const [confirmingUri, setConfirmingUri] = useState<string | null>(null);

  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar" role="tablist" aria-label="Open documents">
      {tabs.map((tab) => {
        const isActive = tab.uri === activeUri;
        const isConfirming = tab.uri === confirmingUri;

        return (
          <div key={tab.uri} className={"tab-bar__tab" + (isActive ? " tab-bar__tab--active" : "")}>
            {isConfirming ? (
              <div className="tab-bar__confirm">
                <button
                  type="button"
                  className="tab-bar__confirm-btn"
                  onClick={() => {
                    setConfirmingUri(null);
                    onSaveAndClose(tab.uri);
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="tab-bar__confirm-btn tab-bar__confirm-btn--discard"
                  onClick={() => {
                    setConfirmingUri(null);
                    onClose(tab.uri);
                  }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="tab-bar__confirm-btn tab-bar__confirm-btn--cancel"
                  aria-label="Cancel"
                  onClick={() => setConfirmingUri(null)}
                >
                  ×
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="tab-bar__activate"
                  onClick={() => onActivate(tab.uri)}
                >
                  {tab.label}
                </button>
                {tab.dirty && <span className="tab-bar__dirty" title="Unsaved changes" aria-hidden="true" />}
                <button
                  type="button"
                  className="tab-bar__close"
                  aria-label={`Close ${tab.label}`}
                  onClick={() => (tab.dirty ? setConfirmingUri(tab.uri) : onClose(tab.uri))}
                >
                  ×
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
