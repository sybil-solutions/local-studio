"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Eye, EyeOff } from "@/ui/icon-registry";

const STORAGE_KEY = "localstudio_censor_api_urls";
const CHANGE_EVENT = "localstudio-api-url-censor-change";

function readCensorPreference(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function useApiUrlCensored(): boolean {
  return useSyncExternalStore(subscribe, readCensorPreference, () => false);
}

export function setApiUrlCensored(censored: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, String(censored));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Visual privacy mode for controller/API addresses during demos and screen sharing. */
export function CensoredApiUrl({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const censored = useApiUrlCensored();
  return (
    <span
      className={`${className}${censored ? " select-none blur-[6px]" : ""}`}
      aria-label={censored ? "API URL censored" : undefined}
    >
      {children}
    </span>
  );
}

export function ApiUrlCensorToggle() {
  const censored = useApiUrlCensored();
  return (
    <button
      type="button"
      onClick={() => setApiUrlCensored(!censored)}
      aria-pressed={censored}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-(--ui-separator) px-2 text-[length:var(--fs-xs)] text-(--ui-muted) transition-colors hover:border-(--ui-fg)/30 hover:text-(--ui-fg)"
      title={censored ? "Reveal API URLs" : "Censor API URLs"}
    >
      {censored ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      {censored ? "Reveal URLs" : "Censor URLs"}
    </button>
  );
}
