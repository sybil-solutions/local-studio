import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { Config } from "../src/config/env";
import type { Logger } from "../src/core/logger";
import { EngineOperationError } from "../src/modules/engines/engine-spec";
import type { ModelDownload } from "../src/modules/engines/types";
import { DownloadManager } from "../src/modules/engines/downloads/download-manager";
import { DownloadStore } from "../src/modules/engines/downloads/download-store";
import {
  DownloadTargetConflict,
  DownloadTargetReservations,
} from "../src/modules/engines/downloads/download-target-reservations";
import type { FetchEffect } from "../src/modules/engines/downloads/huggingface-api";
import { EventManager } from "../src/modules/system/event-manager";

type Deferred<T> = { readonly promise: Promise<T>; readonly resolve: (value: T) => void };
type FetchLike = (url: string, init?: RequestInit) => Promise<Response> | Response;
type Harness = { manager: DownloadManager; root: string; store: DownloadStore };

const harnesses = new Set<Harness>();
const ignore = (): void => undefined;
const logger = {
  debug: ignore,
  info: ignore,
  warn: ignore,
  error: ignore,
  shutdown: () => Effect.void,
} satisfies Logger;
const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);
const deferred = <T>(): Deferred<T> => {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value) => settle?.(value) };
};
const waitFor = async (predicate: () => boolean | Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
const waitStatus = async (
  store: DownloadStore,
  id: string,
  status: ModelDownload["status"],
): Promise<ModelDownload> => {
  await waitFor(async () => (await run(store.get(id)))?.status === status);
  const download = await run(store.get(id));
  if (!download) throw new Error("Download disappeared");
  return download;
};
const toFetchEffect =
  (fetchLike: FetchLike): FetchEffect =>
  (url, init) =>
    Effect.tryPromise({
      try: () => Promise.resolve(fetchLike(url, init)),
      catch: (cause) =>
        new EngineOperationError({ operation: "test-fetch", message: String(cause) }),
    });
const createHarness = async (fetchLike: FetchLike): Promise<Harness> => {
  const root = mkdtempSync(join(tmpdir(), "local-studio-target-lock-"));
  const config: Config = {
    host: "127.0.0.1",
    port: 8080,
    inference_host: "127.0.0.1",
    inference_port: 8000,
    data_dir: root,
    db_path: join(root, "controller.db"),
    models_dir: join(root, "models"),
    strict_openai_models: false,
    cors_origins: [],
    providers: [],
  };
  const store = await run(DownloadStore.make(config.db_path));
  const manager = await run(
    DownloadManager.make(config, store, new EventManager(), logger, toFetchEffect(fetchLike)),
  );
  const harness = { manager, root, store };
  harnesses.add(harness);
  return harness;
};
const modelInfo = (size = 4): Response =>
  Response.json({ sha: "abc123", siblings: [{ rfilename: "model.bin", size }] });

afterEach(async () => {
  for (const harness of harnesses) {
    await run(harness.manager.shutdown());
    await run(harness.store.close());
    rmSync(harness.root, { recursive: true, force: true });
  }
  harnesses.clear();
});

describe("download target reservations", () => {
  test("normalizes physical aliases and prevents stale-owner release", () => {
    const root = mkdtempSync(join(tmpdir(), "local-studio-target-key-"));
    const physical = join(root, "physical");
    const alias = join(root, "alias");
    mkdirSync(physical);
    symlinkSync(physical, alias);
    try {
      const reservations = new DownloadTargetReservations({
        caseInsensitive: true,
        unicodeNormalization: "NFC",
      });
      const first = reservations.acquire(join(alias, "Tree"), "first");
      expect(() => reservations.acquire(join(physical, "tree", "child"), "nested")).toThrow(
        DownloadTargetConflict,
      );
      const sibling = reservations.acquire(join(physical, "other"), "sibling");
      reservations.release(first);
      const replacement = reservations.acquire(join(physical, "TREE"), "replacement");
      reservations.release(first);
      expect(() => reservations.acquire(join(alias, "tree"), "stale-release")).toThrow(
        DownloadTargetConflict,
      );
      reservations.release(replacement);
      reservations.release(sibling);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reserves before metadata and permits unrelated targets", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const pending = [first.promise, second.promise];
    let metadataCalls = 0;
    const { manager, store } = await createHarness((url) => {
      if (url.includes("/resolve/")) return new Response("done");
      metadataCalls += 1;
      return pending.shift() ?? modelInfo();
    });
    const active = run(manager.start({ model_id: "org/one", destination_dir: "shared" }));
    await waitFor(() => metadataCalls === 1);
    await expect(
      run(manager.start({ model_id: "org/two", destination_dir: "shared/." })),
    ).rejects.toBeInstanceOf(DownloadTargetConflict);
    expect(metadataCalls).toBe(1);
    expect(await run(store.list())).toEqual([]);
    const unrelated = run(manager.start({ model_id: "org/three", destination_dir: "unrelated" }));
    await waitFor(() => metadataCalls === 2);
    first.resolve(Response.json({ siblings: [] }));
    second.resolve(Response.json({ siblings: [] }));
    expect(
      (await Promise.allSettled([active, unrelated])).every(
        (result) => result.status === "rejected",
      ),
    ).toBe(true);
    const retry = await run(manager.start({ model_id: "org/retry", destination_dir: "shared" }));
    await waitStatus(store, retry.id, "completed");
  });

  test.each([
    ["pause", "paused"],
    ["cancel", "canceled"],
  ] as const)(
    "%s retains ownership through cleanup and preserves resume",
    async (action, status) => {
      const cleanup = deferred<void>();
      let cancelStarted = false;
      let fileCalls = 0;
      const { manager, store } = await createHarness((url, init) => {
        if (url.includes("/api/models/")) return modelInfo(16);
        fileCalls += 1;
        const range = new Headers(init?.headers).get("Range");
        if (fileCalls > 1) {
          expect(range).toBe("bytes=12-");
          return new Response("rest", { status: 206 });
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller): void {
              controller.enqueue(new TextEncoder().encode("partial-data"));
            },
            async cancel(): Promise<void> {
              cancelStarted = true;
              await cleanup.promise;
            },
          }),
        );
      });
      const started = await run(manager.start({ model_id: `org/${action}` }));
      const partial = join(started.target_dir, "model.bin.part");
      await waitFor(() => existsSync(partial) && statSync(partial).size === 12);
      const interruption = run(
        action === "pause" ? manager.pause(started.id) : manager.cancel(started.id),
      );
      await waitFor(() => cancelStarted);
      const beforeResume = await run(store.get(started.id));
      await expect(run(manager.resume(started.id))).rejects.toBeInstanceOf(DownloadTargetConflict);
      expect(await run(store.get(started.id))).toEqual(beforeResume);
      expect(beforeResume?.status).toBe(status);
      cleanup.resolve();
      await interruption;
      await run(manager.resume(started.id));
      const completed = await waitStatus(store, started.id, "completed");
      expect(readFileSync(join(completed.target_dir, "model.bin"), "utf8")).toBe(
        "partial-datarest",
      );
    },
  );
});
