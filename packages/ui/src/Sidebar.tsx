import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { PanelShell } from "./panels/PanelShell";
import "./Sidebar.css";

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const RESIZE_STEP = 16;

interface SidebarProps {
  title: string;
  caption?: string;
  width: number;
  onWidthChange: (width: number) => void;
  children: ReactNode;
}

// Persistent (Section 7) -- not the ephemeral overlay/pinned-panel duality this replaced.
// Resize handle is its own small drag mechanic, not Seam's: this resizes one pane's pixel
// width against a fixed min/max, not a fraction shared between two flex siblings.
export function Sidebar({ title, caption, width, onWidthChange, children }: SidebarProps) {
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const clampWidth = useCallback((raw: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw)), []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    startXRef.current = event.clientX;
    startWidthRef.current = width;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    onWidthChange(clampWidth(startWidthRef.current + (event.clientX - startXRef.current)));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  // Same pointercancel guard as Seam -- an interrupted drag (OS gesture, focus steal) must not
  // leave the resize stuck "on" for ordinary subsequent pointer movement.
  function handlePointerCancel() {
    draggingRef.current = false;
  }

  return (
    <aside className="sidebar" style={{ width }}>
      <PanelShell title={title} caption={caption}>
        {children}
      </PanelShell>
      <div
        className="sidebar__resize hit-target"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onWidthChange(clampWidth(width - RESIZE_STEP));
          if (event.key === "ArrowRight") onWidthChange(clampWidth(width + RESIZE_STEP));
        }}
      />
    </aside>
  );
}
