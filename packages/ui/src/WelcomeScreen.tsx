import "./WelcomeScreen.css";

interface WelcomeScreenProps {
  onOpenFolder: () => void;
  onNewProject: () => void;
}

export function WelcomeScreen({ onOpenFolder, onNewProject }: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-screen__body">
        <p className="welcome-screen__tagline">Open a folder or start a new project to begin.</p>
        <div className="welcome-screen__actions">
          <button type="button" className="welcome-screen__action welcome-screen__action--primary" onClick={onNewProject}>
            New Project…
          </button>
          <button type="button" className="welcome-screen__action" onClick={onOpenFolder}>
            Open Folder…
          </button>
        </div>
      </div>
    </div>
  );
}
