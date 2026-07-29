import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import "./Seam.css";

export type SeamState = "idle" | "compiling" | "error";

const MIN_PANE_PX = 200;

interface SeamProps {
  state: SeamState;
  containerRef: RefObject<HTMLDivElement>;
  onChange: (fraction: number) => void;
  onReset: () => void;
}

// Draggable via pointer capture (keeps working even if the pointer leaves mid-drag) and the only place compile state renders -- no spinner anywhere else.
export function Seam({ state, containerRef, onChange, onReset }: SeamProps) {
  const draggingRef = useRef(false);

  const clampFraction = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const minFraction = Math.min(0.5, MIN_PANE_PX / rect.width);
    const raw = (clientX - rect.left) / rect.width;
    return Math.min(1 - minFraction, Math.max(minFraction, raw));
  }, [containerRef]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const fraction = clampFraction(event.clientX);
    if (fraction !== null) onChange(fraction);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div
      className="seam hit-target"
      data-state={state}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize editor and preview panes"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onReset();
      }}
    >
      <div className="seam__line" />
    </div>
  );
}
