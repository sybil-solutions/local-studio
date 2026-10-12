"use client";

import { useRef } from "react";

const DISMISS_DISTANCE_PX = 56;

/**
 * Grab bar for the phone-sized sheets (session right sidebar, navigation).
 * Tap or drag it down to dismiss. CSS hides it above the mobile breakpoint,
 * so the same markup is inert on desktop.
 */
export function MobileSheetGrip({ onDismiss, label }: { onDismiss: () => void; label: string }) {
  const startY = useRef<number | null>(null);

  return (
    <button
      type="button"
      className="mobile-sheet-grip"
      aria-label={label}
      onClick={onDismiss}
      onPointerDown={(event) => {
        startY.current = event.clientY;
      }}
      onPointerMove={(event) => {
        if (startY.current === null) return;
        if (event.clientY - startY.current < DISMISS_DISTANCE_PX) return;
        startY.current = null;
        onDismiss();
      }}
      onPointerUp={() => {
        startY.current = null;
      }}
      onPointerCancel={() => {
        startY.current = null;
      }}
    />
  );
}
