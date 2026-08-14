import { useEffect } from "react";
import "./NewProjectDialog.css";

interface NewProjectDialogProps {
  /** `null` means the blank-document option. */
  onSelect: (templateId: string | null) => void;
  onClose: () => void;
}

// Ids match templates/<id>.tex exactly - desktop:scaffoldProject validates against this same set.
const TEMPLATE_OPTIONS: { id: string | null; label: string; description: string }[] = [
  { id: null, label: "Blank Document", description: "An empty article - start from scratch." },
  { id: "article", label: "Article", description: "Title, author, abstract, section skeleton." },
  { id: "ieee", label: "IEEE", description: "IEEE conference paper format." },
  { id: "acm", label: "ACM / SIGCONF", description: "ACM SIGCONF proceedings format." },
  { id: "beamer", label: "Beamer", description: "Slide deck presentation." },
];

export function NewProjectDialog({ onSelect, onClose }: NewProjectDialogProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="new-project-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="new-project-dialog" role="dialog" aria-modal="true" aria-label="New Project">
        <div className="new-project-dialog__header">
          <span className="new-project-dialog__title">New Project</span>
          <button type="button" className="new-project-dialog__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <ul className="new-project-dialog__list">
          {TEMPLATE_OPTIONS.map((option) => (
            <li key={option.id ?? "blank"}>
              <button type="button" className="new-project-dialog__option" onClick={() => onSelect(option.id)}>
                <span className="new-project-dialog__option-label">{option.label}</span>
                <span className="new-project-dialog__option-description">{option.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
