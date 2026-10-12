import { type RefObject } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

/**
 * Closes a popover / dropdown when the user clicks anywhere outside the
 * referenced element. Idempotent — when `open` is false the listener is not
 * registered.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onOutside: () => void,
): void {
  useMountSubscription(() => {
    if (!open || typeof document === "undefined") return;
    const onDocClick = (event: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) {
        onOutside();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [ref, open, onOutside]);
}
