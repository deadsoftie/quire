import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import "./ContextMenu.css";

export interface ContextMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Renders a divider above this item, to group related actions. */
  separatorBefore?: boolean;
  destructive?: boolean;
}

interface ContextMenuProps {
  /** Viewport coordinates from the triggering contextmenu/click event. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_MARGIN = 8;

function nextEnabledIndex(items: ContextMenuItem[], from: number, direction: 1 | -1): number {
  const n = items.length;
  for (let step = 1; step <= n; step++) {
    const candidate = (((from + direction * step) % n) + n) % n;
    if (!items[candidate].disabled) return candidate;
  }
  return from;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const [activeIndex, setActiveIndex] = useState(() => items.findIndex((item) => !item.disabled));
  const [position, setPosition] = useState({ x, y });
  const menuRef = useRef<HTMLUListElement>(null);

  // Runs once the real menu size is known, so it never renders partly off the bottom/right edge.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    menu.focus();
    const rect = menu.getBoundingClientRect();
    const clampedX = Math.max(MENU_MARGIN, Math.min(x, window.innerWidth - rect.width - MENU_MARGIN));
    const clampedY = Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - rect.height - MENU_MARGIN));
    setPosition({ x: clampedX, y: clampedY });
    // Only re-run for a genuinely new open (x/y identity from the caller), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  function runItem(index: number) {
    const item = items[index];
    if (!item || item.disabled) return;
    onClose();
    item.onSelect();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      // Selection here is activeIndex-driven, not real per-item DOM focus (items are tabIndex={-1}
      // below) -- Tab has nothing meaningful left to do inside this menu, so it just closes it
      // rather than silently leaking focus wherever the browser's default tab order would go next.
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => nextEnabledIndex(items, i, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => nextEnabledIndex(items, i, -1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      runItem(activeIndex);
    }
  }

  return (
    <div
      className="context-menu-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onContextMenu={(event) => {
        // A second right-click anywhere just closes this menu rather than stacking a native one underneath.
        event.preventDefault();
        onClose();
      }}
    >
      <ul
        ref={menuRef}
        className="context-menu surface surface--raised"
        role="menu"
        aria-label="File actions"
        tabIndex={-1}
        style={{ left: position.x, top: position.y }}
        onKeyDown={onKeyDown}
      >
        {items.map((item, index) => (
          <li key={item.id} role="none">
            {item.separatorBefore && <div className="context-menu__separator" role="separator" />}
            <button
              type="button"
              role="menuitem"
              // Not part of the tab order -- activeIndex/arrow keys drive selection (see onKeyDown's
              // own Tab handling above); a native tabIndex here would let Tab silently hand real DOM
              // focus to a button with no relation to the activeIndex highlight.
              tabIndex={-1}
              className={
                "context-menu__item" +
                (index === activeIndex ? " context-menu__item--active" : "") +
                (item.destructive ? " context-menu__item--destructive" : "")
              }
              disabled={item.disabled}
              onMouseEnter={() => !item.disabled && setActiveIndex(index)}
              onClick={() => runItem(index)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
