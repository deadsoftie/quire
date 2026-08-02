import { useEffect, useMemo, useRef, useState } from "react";
import type { ReplacedFile, SearchMatch } from "@quire/client";
import { CaseSensitive, ChevronDown, ChevronRight, Regex, WholeWord } from "lucide-react";
import { basename } from "../paths";
import "./SearchPanel.css";

const DEBOUNCE_MS = 300;

interface SearchPanelProps {
  projectId: string;
  dirtyBuffers: { uri: string; text: string }[];
  onSelectMatch: (match: SearchMatch) => void;
  onReplaceAll: (files: ReplacedFile[]) => void;
}

export function SearchPanel({ projectId, dirtyBuffers, onSelectMatch, onReplaceAll }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // Read at fire time, not depended on directly, so a new array reference each render doesn't reset the debounce.
  const dirtyBuffersRef = useRef(dirtyBuffers);
  dirtyBuffersRef.current = dirtyBuffers;

  useEffect(() => {
    if (!projectId || !query) {
      setMatches([]);
      setTruncated(false);
      setError(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    setError(null);
    const timeoutId = window.setTimeout(() => {
      window.quire
        .searchProject({ projectId, query, caseSensitive, wholeWord, regex, dirtyBuffers: dirtyBuffersRef.current })
        .then((resp) => {
          setMatches(resp.matches);
          setTruncated(resp.truncated);
        })
        .catch((err) => setError(String((err as Error)?.message ?? err)))
        .finally(() => setBusy(false));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [projectId, query, caseSensitive, wholeWord, regex, refreshToken]);

  const grouped = useMemo(() => {
    const byUri = new Map<string, SearchMatch[]>();
    for (const match of matches) {
      const list = byUri.get(match.uri);
      if (list) list.push(match);
      else byUri.set(match.uri, [match]);
    }
    return [...byUri.entries()];
  }, [matches]);

  async function handleReplaceAll() {
    if (!projectId || !query) return;
    setReplaceBusy(true);
    setError(null);
    try {
      const resp = await window.quire.replaceInProject({
        projectId,
        query,
        replacement: replaceText,
        caseSensitive,
        wholeWord,
        regex,
        dirtyBuffers: dirtyBuffersRef.current,
      });
      onReplaceAll(resp.files);
      setRefreshToken((t) => t + 1);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setReplaceBusy(false);
    }
  }

  return (
    <div className="search-panel">
      <div className="search-panel__query-row">
        <button
          type="button"
          className="search-panel__disclosure"
          onClick={() => setShowReplace((v) => !v)}
          aria-label={showReplace ? "Hide replace" : "Show replace"}
          aria-expanded={showReplace}
        >
          {showReplace ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        </button>
        <input
          type="text"
          className="search-panel__input"
          placeholder="Search in project"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {showReplace && (
        <div className="search-panel__query-row">
          <span className="search-panel__disclosure-spacer" aria-hidden="true" />
          <input
            type="text"
            className="search-panel__input"
            placeholder="Replace"
            value={replaceText}
            onChange={(event) => setReplaceText(event.target.value)}
          />
        </div>
      )}

      <div className="search-panel__options">
        <button
          type="button"
          className={"search-panel__toggle" + (caseSensitive ? " search-panel__toggle--active" : "")}
          onClick={() => setCaseSensitive((v) => !v)}
          aria-pressed={caseSensitive}
          title="Match case"
        >
          <CaseSensitive size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={"search-panel__toggle" + (wholeWord ? " search-panel__toggle--active" : "")}
          onClick={() => setWholeWord((v) => !v)}
          aria-pressed={wholeWord}
          title="Match whole word"
        >
          <WholeWord size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={"search-panel__toggle" + (regex ? " search-panel__toggle--active" : "")}
          onClick={() => setRegex((v) => !v)}
          aria-pressed={regex}
          title="Use regular expression"
        >
          <Regex size={16} aria-hidden="true" />
        </button>
        {showReplace && (
          <button
            type="button"
            className="search-panel__replace-all"
            disabled={!query || matches.length === 0 || replaceBusy}
            onClick={handleReplaceAll}
          >
            {replaceBusy ? "Replacing…" : `Replace All (${matches.length})`}
          </button>
        )}
      </div>

      {error && <p className="search-panel__error">{error}</p>}

      {!query ? (
        <p className="panel-empty">Type to search across the project.</p>
      ) : busy ? (
        <p className="panel-empty">Searching…</p>
      ) : matches.length === 0 ? (
        <p className="panel-empty">No results.</p>
      ) : (
        <>
          {truncated && <p className="search-panel__truncated">Showing the first {matches.length} matches.</p>}
          <ul className="search-panel__results">
            {grouped.map(([uri, fileMatches]) => (
              <li key={uri} className="search-panel__file">
                <span className="search-panel__file-header">
                  {basename(uri)} <span className="search-panel__file-count">{fileMatches.length}</span>
                </span>
                <ul className="search-panel__matches">
                  {fileMatches.map((match, index) => (
                    <li key={index}>
                      <button type="button" className="search-panel__match-row" onClick={() => onSelectMatch(match)}>
                        <span className="search-panel__line-number">{match.line + 1}</span>
                        <span className="search-panel__line-text">
                          {match.lineText.slice(0, match.column)}
                          <mark className="search-panel__match">
                            {match.lineText.slice(match.column, match.column + match.matchLength)}
                          </mark>
                          {match.lineText.slice(match.column + match.matchLength)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
