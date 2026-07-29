import { useEffect, useMemo, useRef, useState } from "react";
import { useCommandRegistry, usePaletteCommands } from "./CommandContext";
import { rankCommands } from "./fuzzy";
import "./CommandPalette.css";

export function CommandPalette() {
  const { paletteOpen, closePalette } = useCommandRegistry();
  const commands = usePaletteCommands();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => rankCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (!paletteOpen) return;
    setQuery("");
    setActiveIndex(0);
    // The palette mounts open (nothing to focus yet on the same tick).
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [paletteOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!paletteOpen) return null;

  function runResult(index: number) {
    const result = results[index];
    if (!result) return;
    closePalette();
    result.command.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runResult(activeIndex);
    }
  }

  return (
    <div
      className="command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePalette();
      }}
    >
      <div className="command-palette surface surface--raised" role="dialog" aria-modal="true" aria-label="Command Palette">
        <input
          ref={inputRef}
          className="command-palette__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command…"
          aria-autocomplete="list"
          aria-controls="command-palette-list"
          aria-activedescendant={results[activeIndex] ? `command-palette-item-${results[activeIndex].command.id}` : undefined}
        />
        <ul className="command-palette__list" role="listbox" id="command-palette-list">
          {results.length === 0 && <li className="command-palette__empty">No matching commands.</li>}
          {results.map((result, index) => (
            <li
              key={result.command.id}
              id={`command-palette-item-${result.command.id}`}
              role="option"
              aria-selected={index === activeIndex}
              className={
                index === activeIndex ? "command-palette__item command-palette__item--active" : "command-palette__item"
              }
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                runResult(index);
              }}
            >
              <span>{result.command.title}</span>
              {result.command.shortcut && <span className="command-palette__shortcut">{result.command.shortcut}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
