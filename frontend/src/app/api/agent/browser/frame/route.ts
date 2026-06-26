// Frame poll for the visible browser panel. Returns the latest screencast
// JPEG plus nav state as plain JSON:
//   { ok: true, data: { frame: <base64|null>, url, title, canGoBack, canGoForward } }
//
// The panel polls this (~10fps) instead of subscribing to SSE: Next's
// standalone server buffers locally-built event streams, and polling also
// survives a buffering proxy / Cloudflare for remote deploys. Polling keeps
// the host's screencast alive; it auto-stops shortly after polling lapses.

import { browserHost } from "@/features/agent/browser-host/browser-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!browserHost.isAvailable()) {
    return Response.json(
      { ok: false, error: "Browser unavailable: no Chromium found — set LOCAL_STUDIO_CHROME_PATH" },
      { status: 503 },
    );
  }
  try {
    const { frame, state } = await browserHost.pollFrame();
    return Response.json({
      ok: true,
      data: {
        frame: frame?.data ?? null,
        url: state.url,
        title: state.title,
        canGoBack: state.canGoBack,
        canGoForward: state.canGoForward,
      },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "frame poll failed",
    });
  }
}
