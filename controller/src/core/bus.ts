import type { ControllerEvent } from "@local-studio/contracts";

type Listener = (e: ControllerEvent) => void;

export interface Bus {
  emit(e: ControllerEvent): void;
  on(fn: Listener): () => void;
}

export const createBus = (): Bus => {
  const listeners = new Set<Listener>();
  return {
    emit(e) {
      for (const fn of listeners) {
        try {
          fn(e);
        } catch {}
      }
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
};
