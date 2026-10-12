"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

function useCopiedValue<T>(resetMs: number): [T | null, (value: T) => void] {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useMountSubscription(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const trigger = useCallback(
    (next: T) => {
      setValue(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setValue(null), resetMs);
    },
    [resetMs],
  );
  return [value, trigger];
}

export function useCopiedFlag(resetMs = 1200): [boolean, () => void] {
  const [value, trigger] = useCopiedValue<true>(resetMs);
  return [value === true, useCallback(() => trigger(true), [trigger])];
}
