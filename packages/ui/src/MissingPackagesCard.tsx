import "./MissingPackagesCard.css";

export type PackageInstallState = "idle" | "installing" | "offline";

interface MissingPackagesCardProps {
  packages: string[];
  installState: PackageInstallState;
  /** Subset of `packages` still missing after the last install attempt; empty until one runs. */
  failedNames: string[];
  onInstall: () => void;
}

// "Nothing has gone wrong" -- never uses --proof-red; offline gets --proof-amber, everything else stays --nonrepro.
export function MissingPackagesCard({ packages, installState, failedNames, onInstall }: MissingPackagesCardProps) {
  const offline = installState === "offline";
  const label = packages.length === 1 ? "package" : "packages";

  return (
    <div className="missing-packages-card" data-state={offline ? "offline" : "idle"} role="status">
      <p className="missing-packages-card__summary">
        This document uses {packages.length} {label} not included by default:{" "}
        {packages.map((name, i) => (
          <span key={name}>
            <code className="missing-packages-card__name">{name}</code>
            {i < packages.length - 1 ? ", " : ""}
          </span>
        ))}
      </p>
      {offline ? (
        <p className="missing-packages-card__note">
          {failedNames.length > 0 ? "Still couldn't reach the network. " : "You're offline. "}
          Will retry automatically once you're back online.
        </p>
      ) : null}
      <button
        type="button"
        className="missing-packages-card__install"
        onClick={onInstall}
        disabled={installState === "installing"}
      >
        {installState === "installing" ? "Installing…" : offline ? "Retry" : "Install"}
      </button>
    </div>
  );
}
