import "./MissingPackagesCard.css";

export type PackageInstallState = "idle" | "installing" | "offline";

interface MissingPackagesCardProps {
  packages: string[];
  installState: PackageInstallState;
  /** Subset of `packages` still missing after the last install attempt; empty until one runs. */
  failedNames: string[];
  onInstall: () => void;
}

// "Nothing has gone wrong" (9.6) -- this never uses --proof-red, even in the offline sub-state.
// Offline gets --proof-amber (a caution, not an error) since it's the one genuine failure mode
// here, per 9.6's own framing; everything else stays on the neutral --nonrepro accent.
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
