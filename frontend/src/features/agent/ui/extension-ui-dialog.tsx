"use client";

import { useCallback, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { ExtensionUiRequest } from "@/features/agent/runtime/types";

export function ExtensionUiDialog({
  request,
  onRespond,
}: {
  request: ExtensionUiRequest;
  onRespond: (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}) {
  const [value, setValue] = useState(request.prefill ?? "");
  const cancel = useCallback(() => onRespond({ cancelled: true }), [onRespond]);
  useMountSubscription(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel]);

  return (
    <div className="absolute inset-0 z-[220] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-dialog-title"
        className="w-full max-w-md rounded-2xl border border-(--border) bg-(--composer) p-4 shadow-2xl"
      >
        <h2 id="extension-dialog-title" className="text-base font-semibold text-(--fg)">
          {request.title}
        </h2>
        {request.message ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-(--dim)">{request.message}</p>
        ) : null}
        {request.method === "select" ? (
          <div className="mt-4 grid gap-2">
            {(request.options ?? []).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onRespond({ value: option })}
                className="min-h-10 rounded-xl border border-(--border) px-3 text-left text-sm text-(--fg) hover:bg-(--hover)"
              >
                {option}
              </button>
            ))}
          </div>
        ) : request.method === "confirm" ? (
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onRespond({ confirmed: false })}
              className="min-h-10 rounded-xl px-4 text-sm text-(--dim) hover:bg-(--hover)"
            >
              No
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => onRespond({ confirmed: true })}
              className="min-h-10 rounded-xl bg-(--fg) px-4 text-sm font-medium text-(--bg)"
            >
              Yes
            </button>
          </div>
        ) : (
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              onRespond({ value });
            }}
          >
            {request.method === "editor" ? (
              <textarea
                autoFocus
                value={value}
                onChange={(event) => setValue(event.currentTarget.value)}
                className="min-h-44 w-full resize-y rounded-xl border border-(--border) bg-(--color-input) p-3 text-sm text-(--fg) outline-none focus:border-(--link)"
              />
            ) : (
              <input
                autoFocus
                value={value}
                placeholder={request.placeholder}
                onChange={(event) => setValue(event.currentTarget.value)}
                className="h-10 w-full rounded-xl border border-(--border) bg-(--color-input) px-3 text-sm text-(--fg) outline-none focus:border-(--link)"
              />
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancel}
                className="min-h-10 rounded-xl px-4 text-sm text-(--dim) hover:bg-(--hover)"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-10 rounded-xl bg-(--fg) px-4 text-sm font-medium text-(--bg)"
              >
                Continue
              </button>
            </div>
          </form>
        )}
        {request.method === "select" ? (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={cancel}
              className="min-h-10 rounded-xl px-4 text-sm text-(--dim) hover:bg-(--hover)"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
