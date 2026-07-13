import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createConfig } from "../../src/config/env";
import { delay } from "../../src/core/async";
import { createLogger } from "../../src/core/logger";
import { DownloadManager } from "../../src/modules/engines/downloads/download-manager";
import { DownloadStore } from "../../src/modules/engines/downloads/download-store";
import type { FetchLike } from "../../src/modules/engines/downloads/huggingface-api";
import { EventManager } from "../../src/modules/system/event-manager";
import { registerControllerTestLifecycle } from "./fixtures";

registerControllerTestLifecycle();

// The download manager's real-run path talks to huggingface.co over `fetch`
// (its process boundary is HTTP, not child_process). These tests script that
// boundary with a recording fake so the full pipeline — model-info listing,
// byte streaming to .part files, Range resume, rename-on-complete, and the
// abort/cancel state machine — runs for real against temp dirs and SQLite.

type RecordedFetch = { url: string; init: RequestInit | undefined };

type FetchRule = {
  match: (url: string, init?: RequestInit) => boolean;
  respond: (url: string, init?: RequestInit) => Response;
};

const createFakeFetch = (rules: FetchRule[]) => {
  const calls: RecordedFetch[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const rule = rules.find((entry) => entry.match(url, init));
    if (!rule) throw new Error(`Unexpected fetch: ${url}`);
    return rule.respond(url, init);
  };
  return { fetchImpl, calls, rules };
};

const modelInfoRule = (siblings: Array<{ rfilename: string; size: number }>): FetchRule => ({
  match: (url) => url.includes("/api/models/"),
  respond: () => Response.json({ sha: "abc123", siblings }),
});

const fileRule = (path: string, content: string): FetchRule => ({
  match: (url) => url.endsWith(`/resolve/abc123/${path}`),
  respond: () =>
    new Response(content, {
      status: 200,
      headers: { "content-length": String(content.length) },
    }),
});

/** Streams one chunk, then stalls until the caller's abort signal fires. */
const stalledFileRule = (path: string, firstChunk: string, onChunk: () => void): FetchRule => ({
  // Only the initial (non-Range) request stalls; the resume request must be
  // free to match a later-registered Range rule.
  match: (url, init) =>
    url.endsWith(`/resolve/abc123/${path}`) && !new Headers(init?.headers).get("Range"),
  respond: (_url, init) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(firstChunk));
          onChunk();
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("The operation was aborted.", "AbortError"));
          });
        },
      }),
      { status: 200 },
    ),
});

const createManager = (fetchImpl: FetchLike) => {
  const config = createConfig();
  const store = new DownloadStore(config.db_path);
  const manager = new DownloadManager(
    config,
    store,
    new EventManager(),
    createLogger("error"),
    fetchImpl,
  );
  return { config, store, manager };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await delay(20);
  }
};

describe("download manager real-run path via the fetch seam", () => {
  test("happy path: streams every listed file to disk and completes", async () => {
    const { fetchImpl, calls } = createFakeFetch([
      modelInfoRule([
        { rfilename: "config.json", size: 12 },
        { rfilename: "model.safetensors", size: 16 },
      ]),
      fileRule("config.json", "x".repeat(12)),
      fileRule("model.safetensors", "y".repeat(16)),
    ]);
    const { store, manager } = createManager(fetchImpl);

    const started = await manager.start({ model_id: "acme/tiny-model" });
    expect(started.status).toBe("queued");
    expect(started.revision).toBe("abc123");
    expect(started.total_bytes).toBe(28);

    await waitFor(() => store.get(started.id)?.status === "completed");

    const finished = store.get(started.id)!;
    expect(finished.downloaded_bytes).toBe(28);
    expect(finished.error).toBeNull();
    expect(finished.files.map((file) => file.status)).toEqual(["completed", "completed"]);

    // Files land under models_dir/<model id> with .part staging cleaned up.
    expect(readFileSync(join(finished.target_dir, "config.json"), "utf8")).toBe("x".repeat(12));
    expect(readFileSync(join(finished.target_dir, "model.safetensors"), "utf8")).toBe(
      "y".repeat(16),
    );
    expect(existsSync(join(finished.target_dir, "config.json.part"))).toBe(false);
    expect(existsSync(join(finished.target_dir, "model.safetensors.part"))).toBe(false);

    expect(calls[0]!.url).toBe("https://huggingface.co/api/models/acme/tiny-model");
    expect(calls.map((call) => call.url).slice(1)).toEqual([
      "https://huggingface.co/acme/tiny-model/resolve/abc123/config.json",
      "https://huggingface.co/acme/tiny-model/resolve/abc123/model.safetensors",
    ]);
  });

  test("a failing file request marks the download failed with the HTTP error", async () => {
    const { fetchImpl } = createFakeFetch([
      modelInfoRule([{ rfilename: "model.safetensors", size: 16 }]),
      {
        match: (url) => url.includes("/resolve/"),
        respond: () => new Response("denied", { status: 500, statusText: "Server Error" }),
      },
    ]);
    const { store, manager } = createManager(fetchImpl);

    const started = await manager.start({ model_id: "acme/tiny-model" });
    await waitFor(() => store.get(started.id)?.status === "failed");

    const failed = store.get(started.id)!;
    expect(failed.error).toContain("Download failed: 500");
  });

  test("a short body marks the file errored, keeps the .part artifact, and fails the run", async () => {
    const { fetchImpl } = createFakeFetch([
      modelInfoRule([{ rfilename: "model.safetensors", size: 16 }]),
      {
        // Claims 16 bytes in the listing but the body only carries 8.
        match: (url) => url.includes("/resolve/"),
        respond: () => new Response("y".repeat(8), { status: 200 }),
      },
    ]);
    const { store, manager } = createManager(fetchImpl);

    const started = await manager.start({ model_id: "acme/tiny-model" });
    await waitFor(() => store.get(started.id)?.status === "failed");

    const failed = store.get(started.id)!;
    expect(failed.error).toContain("Incomplete download for model.safetensors");
    expect(failed.files[0]!.status).toBe("error");
    // The partial artifact is deliberately retained for a Range resume.
    expect(statSync(join(failed.target_dir, "model.safetensors.part")).size).toBe(8);
    expect(existsSync(join(failed.target_dir, "model.safetensors"))).toBe(false);
  });

  test("mid-download cancel keeps the .part artifact and a resume completes it via a Range request", async () => {
    let firstChunkSeen = false;
    const fake = createFakeFetch([
      modelInfoRule([{ rfilename: "model.safetensors", size: 16 }]),
      stalledFileRule("model.safetensors", "partial-data", () => {
        firstChunkSeen = true;
      }),
    ]);
    const { store, manager } = createManager(fake.fetchImpl);

    const started = await manager.start({ model_id: "acme/tiny-model" });
    await waitFor(() => firstChunkSeen);
    // Let the reader loop consume the chunk before pulling the plug.
    await delay(50);

    manager.cancel(started.id);
    // The aborted run's writer flushes and closes the staging file on its way
    // out; waiting on its final size also guarantees the resume below sees
    // the full 12 bytes when it computes its Range offset.
    const partPath = join(started.target_dir, "model.safetensors.part");
    await waitFor(() => existsSync(partPath) && statSync(partPath).size === 12);

    const canceled = store.get(started.id)!;
    expect(canceled.status).toBe("canceled");
    // The partial artifact survives in the staging file for resume.
    expect(existsSync(partPath)).toBe(true);
    expect(existsSync(join(canceled.target_dir, "model.safetensors"))).toBe(false);

    // Resume: the manager must ask for the remainder, get a 206, and append.
    fake.rules.push({
      match: (_url, init) =>
        new Headers(init?.headers).get("Range") === "bytes=12-",
      respond: () =>
        new Response("rest", { status: 206, headers: { "content-length": "4" } }),
    });
    manager.resume(started.id);
    await waitFor(() => store.get(started.id)?.status === "completed");

    const finished = store.get(started.id)!;
    expect(finished.downloaded_bytes).toBe(16);
    expect(readFileSync(join(finished.target_dir, "model.safetensors"), "utf8")).toBe(
      "partial-datarest",
    );
    expect(existsSync(join(finished.target_dir, "model.safetensors.part"))).toBe(false);
  });
});
