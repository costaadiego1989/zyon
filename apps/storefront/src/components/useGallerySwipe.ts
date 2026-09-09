"use client";

import { useRef, type PointerEvent, type MouseEvent } from "react";

/** Own horizontal gestures in a gallery while leaving vertical page scrolling native. */
export function useGallerySwipe(enabled: boolean, onMove: (direction: number) => void) {
  const gesture = useRef<{ x: number; y: number; horizontal: boolean } | null>(null);
  const suppressClick = useRef(false);
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      suppressClick.current = false;
      if (!enabled || !event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
      gesture.current = { x: event.clientX, y: event.clientY, horizontal: false };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const start = gesture.current;
      if (!start) return;
      const dx = Math.abs(event.clientX - start.x);
      const dy = Math.abs(event.clientY - start.y);
      if (!start.horizontal && dy > 10 && dy > dx) { gesture.current = null; return; }
      if (dx > 10 && dx > dy && !start.horizontal) {
        start.horizontal = true;
        suppressClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const start = gesture.current;
      gesture.current = null;
      if (!start?.horizontal) return;
      const dx = event.clientX - start.x;
      if (Math.abs(dx) >= 36) onMove(dx < 0 ? 1 : -1);
    },
    onPointerCancel() { gesture.current = null; },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
