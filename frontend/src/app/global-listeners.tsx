"use client";

import { useControllerEvents } from "@/hooks/use-controller-events";

export function GlobalListeners() {
  useControllerEvents();
  return null;
}
