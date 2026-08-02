import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Regex, WholeWord, X } from "lucide-react";
import { SearchQuery, findNext, findPrevious, replaceAll as cmReplaceAll, replaceNext, setSearchQuery } from "@codemirror/search";
import type { EditorHandle } from "./Editor";
import "./FindWidget.css";

export interface FindWidgetHandle {
  open(withReplace: boolean): void;
}

interface FindWidgetProps {
  editorRef: RefObject<EditorHandle>;
  activeUri: string | null;
}

const MAX_SEED_LENGTH = 200;

export const FindWidget = forwardRef<FindWidgetHandle, FindWidgetProps>(function FindWidget(
  { editorRef, activeUri },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [matchCount, setMatchCount] = useState<{ current: number; total: number } | null>(null);

  const searchQuery = useMemo(
    () => new SearchQuery({ search: query, replace: replaceText, caseSensitive, wholeWord, regexp: regex }),
    [query, replaceText, caseSensitive, wholeWord, regex],
  );

  // Keeps @codemirror/search's own state field (and its match highlighting) in sync with our local form state.
  useEffect(() => {
    if (!open) return;
    const view = editorRef.current?.getView();
    view?.dispatch({ effects: setSearchQuery.of(searchQuery) });
  }, [open, searchQuery, editorRef]);

  // @codemirror/search doesn't push a match count itself, so this walks the same cursor CM6 uses internally.
  useEffect(() => {
    if (!open) {
      setMatchCount(null);
      return;
    }
    const view = editorRef.current?.getView();
    if (!view || !searchQuery.valid) {
      setMatchCount(null);
      return;
    }
    const cursor = searchQuery.getCursor(view.state);
    const head = view.state.selection.main.to;
    let total = 0;
    let current = 0;
    for (let result = cursor.next(); !result.done; result = cursor.next()) {
      total++;
      if (result.value.to <= head) current = total;
    }
    setMatchCount({ current: total > 0 ? Math.max(current, 1) : 0, total });
  }, [open, searchQuery, editorRef, activeUri]);

  useImperativeHandle(
    ref,
    () => ({
      open: (withReplace: boolean) => {
        const view = editorRef.current?.getView();
        const selection = view?.state.selection.main;
        if (view && selection && !selection.empty && selection.to - selection.from < MAX_SEED_LENGTH) {
          setQuery(view.state.sliceDoc(selection.from, selection.to));
        }
        setShowReplace(withReplace);
        setOpen(true);
      },
    }),
    [editorRef],
  );

  const close = useCallback(() => {
    setOpen(false);
    editorRef.current?.getView()?.focus();
  }, [editorRef]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    },
    [close],
  );

  if (!open || !activeUri) return null;

  const hasMatches = (matchCount?.total ?? 0) > 0;

  return (
    <div className="find-widget" onKeyDown={onKeyDown}>
      <div className="find-widget__row">
        <button
          type="button"
          className="find-widget__disclosure"
          onClick={() => setShowReplace((v) => !v)}
          aria-label={showReplace ? "Hide replace" : "Show replace"}
          aria-expanded={showReplace}
        >
          {showReplace ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        </button>
        <input
          type="text"
          className="find-widget__input"
          placeholder="Find"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const view = editorRef.current?.getView();
            if (view) (event.shiftKey ? findPrevious : findNext)(view);
          }}
        />
        <span className="find-widget__count">
          {matchCount ? (hasMatches ? `${matchCount.current} of ${matchCount.total}` : "No results") : ""}
        </span>
        <button
          type="button"
          className={"find-widget__toggle" + (caseSensitive ? " find-widget__toggle--active" : "")}
          onClick={() => setCaseSensitive((v) => !v)}
          aria-pressed={caseSensitive}
          title="Match case"
        >
          <CaseSensitive size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={"find-widget__toggle" + (wholeWord ? " find-widget__toggle--active" : "")}
          onClick={() => setWholeWord((v) => !v)}
          aria-pressed={wholeWord}
          title="Match whole word"
        >
          <WholeWord size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={"find-widget__toggle" + (regex ? " find-widget__toggle--active" : "")}
          onClick={() => setRegex((v) => !v)}
          aria-pressed={regex}
          title="Use regular expression"
        >
          <Regex size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="find-widget__icon-button"
          onClick={() => {
            const view = editorRef.current?.getView();
            if (view) findPrevious(view);
          }}
          disabled={!hasMatches}
          title="Previous match"
        >
          <ChevronUp size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="find-widget__icon-button"
          onClick={() => {
            const view = editorRef.current?.getView();
            if (view) findNext(view);
          }}
          disabled={!hasMatches}
          title="Next match"
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button type="button" className="find-widget__icon-button" onClick={close} title="Close (Esc)">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {showReplace && (
        <div className="find-widget__row">
          <span className="find-widget__disclosure-spacer" aria-hidden="true" />
          <input
            type="text"
            className="find-widget__input"
            placeholder="Replace"
            value={replaceText}
            onChange={(event) => setReplaceText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const view = editorRef.current?.getView();
              if (view) replaceNext(view);
            }}
          />
          <button
            type="button"
            className="find-widget__text-button"
            disabled={!hasMatches}
            onClick={() => {
              const view = editorRef.current?.getView();
              if (view) replaceNext(view);
            }}
          >
            Replace
          </button>
          <button
            type="button"
            className="find-widget__text-button"
            disabled={!hasMatches}
            onClick={() => {
              const view = editorRef.current?.getView();
              if (view) cmReplaceAll(view);
            }}
          >
            Replace All
          </button>
        </div>
      )}
    </div>
  );
});
