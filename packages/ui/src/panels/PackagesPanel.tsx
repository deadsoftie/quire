import { useEffect, useState } from "react";
import type { InstalledPackage } from "@quire/client";
import "./PackagesPanel.css";

export function formatBytes(raw: number | bigint): string {
  const bytes = Number(raw);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PackagesPanelProps {
  /** Called after a successful install or remove, so callers tracking cache size elsewhere (the sidebar caption) can refetch too. */
  onChanged?: () => void;
}

export function PackagesPanel({ onChanged }: PackagesPanelProps) {
  const [packages, setPackages] = useState<InstalledPackage[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [query, setQuery] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [removingName, setRemovingName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.quire.listInstalledPackages().then((result) => {
      if (!cancelled) setPackages(result);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const trimmedQuery = query.trim();
  const filtered = trimmedQuery
    ? packages.filter((pkg) => pkg.name.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : packages;

  async function handleInstall() {
    if (!trimmedQuery) return;
    setInstalling(true);
    setInstallError(null);
    try {
      await window.quire.installPackage(trimmedQuery);
      setQuery("");
      setRefreshToken((t) => t + 1);
      onChanged?.();
    } catch (err) {
      setInstallError(String((err as Error)?.message ?? err));
    } finally {
      setInstalling(false);
    }
  }

  async function handleRemove(name: string) {
    setRemovingName(name);
    try {
      await window.quire.removePackage(name);
      setRefreshToken((t) => t + 1);
      onChanged?.();
    } finally {
      setRemovingName(null);
    }
  }

  return (
    <div className="packages-panel">
      <input
        type="text"
        className="packages-panel__search"
        placeholder="Search or install a package…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setInstallError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && filtered.length === 0 && trimmedQuery) handleInstall();
        }}
      />

      {filtered.length === 0 && trimmedQuery ? (
        <div className="packages-panel__install">
          <button type="button" className="packages-panel__install-button" onClick={handleInstall} disabled={installing}>
            {installing ? "Installing…" : `Install "${trimmedQuery}"`}
          </button>
          {installError && <p className="packages-panel__error">{installError}</p>}
        </div>
      ) : null}

      {packages.length === 0 && !trimmedQuery ? (
        <p className="panel-empty">No packages installed yet.</p>
      ) : (
        <ul className="packages-panel__list">
          {filtered.map((pkg) => (
            <li key={pkg.name} className="packages-panel__item">
              <span className="packages-panel__name">{pkg.name}</span>
              {pkg.source === "core" ? (
                <span className="packages-panel__badge">Built-in</span>
              ) : (
                <>
                  <span className="packages-panel__size">{formatBytes(pkg.bytes ?? 0)}</span>
                  <button
                    type="button"
                    className="packages-panel__remove"
                    onClick={() => handleRemove(pkg.name)}
                    disabled={removingName === pkg.name}
                  >
                    {removingName === pkg.name ? "Removing…" : "Remove"}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
