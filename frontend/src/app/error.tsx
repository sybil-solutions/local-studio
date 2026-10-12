"use client";

import { isChunkLoadError, recoverByReload } from "@/app/chunk-recovery";

// Root error boundary for the whole app. Two jobs:
//
//  1. Self-heal stale-chunk failures. After a redeploy, an already-open tab
//     still references the previous build's chunk hashes; those 404 against the
//     new build and throw a ChunkLoadError when a route's code is loaded
//     (e.g. navigating to /agent/sessions). Without a boundary, Next.js shows a
//     dead "Application error" page. recoverByReload() reloads once (guarded) to
//     fetch the current build.
//
//  2. Give every other render error a friendly retry instead of a blank screen.
//
// NOTE: there is intentionally no useEffect — React effect hooks are banned
// project-wide. The one-shot recovery runs from a ref callback (commit time),
// which is idempotent thanks to the sessionStorage guard in recoverByReload().

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunkError = isChunkLoadError(error);

  return (
    <div
      // Commit-time hook without useEffect: trigger the one-shot reload for
      // stale-chunk errors as soon as this boundary mounts.
      ref={chunkError ? () => void recoverByReload() : undefined}
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "14px",
        padding: "48px 24px",
        textAlign: "center",
        color: "var(--fg, #e6e6e6)",
        background: "var(--bg, #0a0a0a)",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {chunkError ? (
        <p style={{ fontSize: "13px", opacity: 0.75 }}>Updating to the latest version…</p>
      ) : (
        <>
          <p style={{ fontSize: "14px", fontWeight: 600 }}>Something went wrong.</p>
          <p style={{ fontSize: "12.5px", opacity: 0.7, maxWidth: "440px" }}>
            This view hit an unexpected error. You can retry it, or reload the app.
          </p>
          <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                height: "32px",
                padding: "0 14px",
                borderRadius: "6px",
                border: "1px solid var(--separator, #2a2a2a)",
                background: "var(--surface, #161616)",
                color: "inherit",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: "32px",
                padding: "0 14px",
                borderRadius: "6px",
                border: "1px solid transparent",
                background: "var(--hl2, #3a6df0)",
                color: "#fff",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </>
      )}
    </div>
  );
}
