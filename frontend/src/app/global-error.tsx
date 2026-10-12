"use client";

import { isChunkLoadError, recoverByReload } from "@/app/chunk-recovery";

// Last-resort boundary: catches errors thrown by the root layout itself
// (including a stale shared chunk that the layout depends on), which the
// segment-level error.tsx cannot catch. Must render its own <html>/<body>.
// No useEffect — recovery runs from a ref callback, guarded against loops.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunkError = isChunkLoadError(error);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "14px",
          padding: "48px 24px",
          textAlign: "center",
          color: "#e6e6e6",
          background: "#0a0a0a",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div ref={chunkError ? () => void recoverByReload() : undefined}>
          {chunkError ? (
            <p style={{ fontSize: "13px", opacity: 0.75 }}>Updating to the latest version…</p>
          ) : (
            <>
              <p style={{ fontSize: "14px", fontWeight: 600 }}>Something went wrong.</p>
              <p
                style={{
                  fontSize: "12.5px",
                  opacity: 0.7,
                  maxWidth: "440px",
                  margin: "8px auto 0",
                }}
              >
                The app hit an unexpected error while loading.
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  marginTop: "14px",
                  justifyContent: "center",
                }}
              >
                <button
                  type="button"
                  onClick={() => reset()}
                  style={{
                    height: "32px",
                    padding: "0 14px",
                    borderRadius: "6px",
                    border: "1px solid #2a2a2a",
                    background: "#161616",
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
                    background: "#3a6df0",
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
      </body>
    </html>
  );
}
