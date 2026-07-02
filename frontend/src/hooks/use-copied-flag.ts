"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

/**
 * "Copied!" feedback state: `trigger(value)` holds the value for `resetMs`
 * then clears it. Retriggering restarts the window; the pending timer is
 * cleared on unmount so it never fires setState on an unmounted component.
 */
export function useCopiedValue<T>(resetMs = 1200): [T | null, (value: T) => void] {
  const [value, setValue] = useState<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useMountSubscription(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
  const trigger = useCallback(
    (next: T) => {
      setValue(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setValue(null), resetMs);
    },
    [resetMs],
  );
  return [value, trigger];
}

/** Boolean convenience over {@link useCopiedValue} for single-target copy buttons. */
export function useCopiedFlag(resetMs = 1200): [boolean, () => void] {
  const [value, trigger] = useCopiedValue<true>(resetMs);
  return [value === true, useCallback(() => trigger(true), [trigger])];
}
