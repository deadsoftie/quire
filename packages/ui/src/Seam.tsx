import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import "./Seam.css";

export type SeamState = "idle" | "compiling" | "error";

const MIN_PANE_PX = 200;
// Matches --s-2 (packages/design/src/tokens.css); `frac` is a fraction of the width remaining after this fixed column, not the full width.
const SEAM_WIDTH_PX = 8;

// Pure so it's testable without a DOM - rectLeft/rectWidth are just getBoundingClientRect()'s fields.
export function computeSplitFraction(clientX: number, rectLeft: number, rectWidth: number): number | null {
  const usableWidth = rectWidth - SEAM_WIDTH_PX;
  if (rectWidth === 0 || usableWidth <= 0) return null;
  const minFraction = Math.min(0.5, MIN_PANE_PX / usableWidth);
  // Measured against the seam's own center, so the boundary itself tracks the cursor, not some offset edge.
  const x = clientX - rectLeft - SEAM_WIDTH_PX / 2;
  const raw = x / usableWidth;
  return Math.min(1 - minFraction, Math.max(minFraction, raw));
}

interface SeamProps {
  state: SeamState;
  containerRef: RefObject<HTMLDivElement>;
  onChange: (fraction: number) => void;
  onReset: () => void;
}

export function Seam({ state, containerRef, onChange, onReset }: SeamProps) {
  const draggingRef = useRef(false);

  const clampFraction = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return computeSplitFraction(clientX, rect.left, rect.width);
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

  // The OS can interrupt a drag with pointercancel instead of pointerup, so this must reset dragging state too.
  function handlePointerCancel() {
    draggingRef.current = false;
  }

  return (
    <div className="seam" data-state={state}>
      <div className="seam__line" />
      {/* A wider, absolutely-positioned hit area, deliberately separate from .seam itself: .seam
          is a real grid item and must stay exactly SEAM_WIDTH_PX wide to match the grid's own
          fixed track, or the two overflow their column into a neighboring pane - confirmed to
          visually misplace the line itself, not just the click target. hit-target's min-width
          only inflates *this* absolutely-positioned element, which doesn't participate in the
          grid's own sizing. */}
      <div
        className="seam__hit-area hit-target"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize editor and preview panes"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={onReset}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onReset();
        }}
      />
    </div>
  );
}
