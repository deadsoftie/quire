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
  action?: ReactNode;
  width: number;
  onWidthChange: (width: number) => void;
  children: ReactNode;
}

export function Sidebar({ title, caption, action, width, onWidthChange, children }: SidebarProps) {
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

  // The OS can interrupt a drag with pointercancel instead of pointerup, so this must reset dragging state too.
  function handlePointerCancel() {
    draggingRef.current = false;
  }

  return (
    <aside className="sidebar" style={{ width }}>
      <PanelShell title={title} caption={caption} action={action}>
        {children}
      </PanelShell>
      <div
        className="sidebar__resize"
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
