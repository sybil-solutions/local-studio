"use client";

import { useState, type RefObject } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

/**
 * One focus trap for every overlay surface in the app.
 *
 * Modals and drawers are the same accessibility problem — a layer that steals
 * the page — so they get the same answer: Escape closes, Tab cycles inside,
 * and focus returns to whatever opened the surface. This used to live only in
 * `ui/modal.tsx`, which is why drawers shipped with an Escape listener and
 * nothing else.
 */

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true",
  );
}

export function useDialogFocusTrap({
  dialogRef,
  active,
  onClose,
  focusFirstElement = true,
}: {
  dialogRef: RefObject<HTMLElement | null>;
  active: boolean;
  onClose: () => void;
  /**
   * Modals put the caret on their first control. Drawers focus the panel
   * itself instead: they are wide surfaces opened beside the page, and landing
   * inside a text field on open reads as the app grabbing the keyboard.
   */
  focusFirstElement?: boolean;
}): void {
  const [callbacks] = useState(() => ({ onClose }));
  callbacks.onClose = onClose;

  useMountSubscription(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    const initial = focusFirstElement ? focusableElements(dialog)[0] : null;
    (initial ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        callbacks.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const current = focusableElements(dialog);
      if (!current.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [active]);
}
