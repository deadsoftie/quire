/** Minimal shape shared with App.tsx's own OpenTab -- kept generic so this stays independently testable. */
export interface UriKeyed {
  uri: string;
}

export interface UriRewriteResult<T extends UriKeyed> {
  tabs: T[];
  /** The active tab's new uri, or `null` if the active tab wasn't affected by this rewrite. */
  nextActiveUri: string | null;
}

/**
 * Rewrites every open tab whose uri is `oldUri` itself, or nested under it as a directory
 * (`oldUri/...`), to the corresponding path under `newUri`. Used by rename and move so an open,
 * possibly-unsaved tab survives either operation in place rather than being closed and reopened
 * (which would silently discard unsaved edits and cursor/scroll position).
 */
export function rewriteTabUris<T extends UriKeyed>(
  tabs: T[],
  oldUri: string,
  newUri: string,
  activeUri: string | null,
): UriRewriteResult<T> {
  const rewrite = (candidate: string): string | null => {
    if (candidate === oldUri) return newUri;
    if (candidate.startsWith(oldUri + "/")) return newUri + candidate.slice(oldUri.length);
    return null;
  };

  let nextActiveUri: string | null = null;
  const next = tabs.map((tab) => {
    const rewritten = rewrite(tab.uri);
    if (rewritten === null) return tab;
    if (tab.uri === activeUri) nextActiveUri = rewritten;
    return { ...tab, uri: rewritten };
  });

  return { tabs: next, nextActiveUri };
}
