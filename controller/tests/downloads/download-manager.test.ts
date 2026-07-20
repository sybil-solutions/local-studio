import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { makeAppContext } from "../../src/app-context";
import type { Config } from "../../src/config/env";
import { createControllerRuntime } from "../../src/core/effect-runtime";
import type { Logger } from "../../src/core/logger";
import { createApp } from "../../src/http/app";
import { EngineOperationError } from "../../src/modules/engines/engine-spec";
import type { ModelDownload } from "../../src/modules/engines/types";
import { DownloadManager } from "../../src/modules/engines/downloads/download-manager";
import { DownloadStore } from "../../src/modules/engines/downloads/download-store";
import { DownloadTargetConflict } from "../../src/modules/engines/downloads/download-target-reservations";
import type { FetchEffect } from "../../src/modules/engines/downloads/huggingface-api";
import { EventManager } from "../../src/modules/system/event-manager";

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response> | Response;

type Harness = {
  readonly config: Config;
  readonly manager: DownloadManager;
  readonly root: string;
  readonly store: DownloadStore;
};

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

const delay = (milliseconds: number): Promise<void> => run(Effect.sleep(milliseconds));

const deferred = <T>(): Deferred<T> => {
  let settle: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value): void => {
      if (!settle) throw new Error("Deferred is not initialized");
      settle(value);
    },
  };
};

const createConfig = (root: string): Config => ({
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
});

const toFetchEffect = (fetchLike: FetchLike): FetchEffect => (url, init) =>
  Effect.tryPromise({
    try: () => Promise.resolve(fetchLike(url, init)),
    catch: (cause) =>
      new EngineOperationError({
        operation: "test-fetch",
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });

const createHarness = async (fetchLike: FetchLike): Promise<Harness> => {
  const root = mkdtempSync(join(tmpdir(), "local-studio-download-manager-"));
  const config = createConfig(root);
  const store = await run(DownloadStore.make(config.db_path));
  const manager = await run(
    DownloadManager.make(config, store, new EventManager(), logger, toFetchEffect(fetchLike)),
  );
  const harness = { config, manager, root, store };
  harnesses.add(harness);
  return harness;
};

const modelInfo = (size = 4): Response =>
  Response.json({
    sha: "abc123",
    siblings: [{ rfilename: "model.safetensors", size }],
  });

const fileResponse = (body = "done"): Response =>
  new Response(body, {
    status: 200,
    headers: { "content-length": String(body.length) },
  });

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMilliseconds = 5_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await delay(10);
  }
};

const waitForStatus = async (
  store: DownloadStore,
  id: string,
  status: ModelDownload["status"],
): Promise<ModelDownload> => {
  await waitFor(async () => (await run(store.get(id)))?.status === status);
  const download = await run(store.get(id));
  if (!download) throw new Error(`Download ${id} disappeared`);
  return download;
};

const resumeWhenAvailable = async (manager: DownloadManager, id: string): Promise<void> => {
  while (true) {
    try {
      await run(manager.resume(id));
      return;
    } catch (error) {
      if (!(error instanceof DownloadTargetConflict)) throw error;
      await delay(10);
    }
  }
};

const responseDetail = async (response: Response): Promise<string> => {
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Expected an object response");
  }
  const detail = Reflect.get(body, "detail");
  if (typeof detail !== "string") throw new Error("Expected a response detail");
  return detail;
};

const withEnvironment = async <T>(
  values: Record<string, string>,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

afterEach(async () => {
  for (const harness of harnesses) {
    await run(harness.manager.shutdown());
    await run(harness.store.close());
    rmSync(harness.root, { recursive: true, force: true });
  }
  harnesses.clear();
});

describe("download manager target ownership", () => {
  test("rehydrates active records without reserving inactive targets", async () => {
    const fetchLike: FetchLike = (url) => {
      if (url.includes("/api/models/")) return modelInfo();
      if (url.includes("/resolve/")) return fileResponse();
      throw new Error(`Unexpected fetch ${url}`);
    };
    const { config, store } = await createHarness(fetchLike);
    const now = new Date().toISOString();
    const queued: ModelDownload = {
      id: "queued-download",
      model_id: "acme/queued",
      revision: "abc123",
      status: "queued",
      created_at: now,
      updated_at: now,
      target_dir: join(config.models_dir, "rehydrated"),
      total_bytes: 4,
      downloaded_bytes: 0,
      files: [
        {
          path: "model.safetensors",
          size_bytes: 4,
          downloaded_bytes: 0,
          status: "pending",
        },
      ],
      error: null,
    };
    await run(store.save(queued));
    await run(store.save({ ...queued, id: "completed-download", status: "completed" }));

    const restarted = await run(
      DownloadManager.make(config, store, new EventManager(), logger, toFetchEffect(fetchLike)),
    );
    expect(await run(restarted.get(queued.id))).toMatchObject({
      status: "paused",
      error: "Restart required",
    });
    expect(await run(restarted.get("completed-download"))).toMatchObject({
      status: "completed",
      error: null,
    });
    await run(restarted.shutdown());
  });

  test("reports an unwritable models path before target reservation", async () => {
    const { config, manager, root } = await createHarness(() => modelInfo());
    const modelsFile = join(root, "models-file");
    writeFileSync(modelsFile, "not a directory");
    const originalModelsDirectory = config.models_dir;
    config.models_dir = modelsFile;
    try {
      await expect(run(manager.start({ model_id: "acme/unwritable" }))).rejects.toThrow(
        `Models directory is not writable by the controller: ${modelsFile}`,
      );
    } finally {
      config.models_dir = originalModelsDirectory;
    }
  });

  test("reserves equivalent targets before metadata and permits distinct targets", async () => {
    const firstMetadata = deferred<Response>();
    const distinctMetadata = deferred<Response>();
    const responses = [firstMetadata.promise, distinctMetadata.promise];
    let metadataCalls = 0;
    const fetchLike: FetchLike = async (url) => {
      if (!url.includes("/api/models/")) throw new Error(`Unexpected fetch ${url}`);
      metadataCalls += 1;
      const response = responses.shift();
      if (!response) throw new Error("Unexpected metadata request");
      return response;
    };
    const { config, manager } = await createHarness(fetchLike);

    const active = run(
      manager.start({
        model_id: "https://huggingface.co/acme/source-model",
        destination_dir: "shared",
      }),
    );
    await waitFor(() => metadataCalls === 1);

    await expect(
      run(
        manager.start({
          model_id: "acme/recipe-model",
          destination_dir: "shared/.",
        }),
      ),
    ).rejects.toMatchObject({
      activeDownloadId: expect.any(String),
      target: join(config.models_dir, "shared"),
    });
    expect(metadataCalls).toBe(1);
    expect(await run(manager.list())).toEqual([]);

    const distinct = run(
      manager.start({
        model_id: "acme/distinct-model",
        destination_dir: "distinct",
      }),
    );
    await waitFor(() => metadataCalls === 2);

    firstMetadata.resolve(Response.json({ sha: "abc123", siblings: [] }));
    distinctMetadata.resolve(Response.json({ sha: "abc123", siblings: [] }));
    expect(await Promise.allSettled([active, distinct])).toEqual([
      {
        status: "rejected",
        reason: expect.objectContaining({ message: "No downloadable files found for this model" }),
      },
      {
        status: "rejected",
        reason: expect.objectContaining({ message: "No downloadable files found for this model" }),
      },
    ]);
  });

  test.each([
    ["metadata request", (): Response => new Response("unavailable", { status: 503 })],
    ["empty metadata", (): Response => Response.json({ sha: "abc123", siblings: [] })],
  ])("releases a target after a failed %s", async (_failure, failedResponse) => {
    let metadataCalls = 0;
    const fetchLike: FetchLike = (url) => {
      if (url.includes("/api/models/")) {
        metadataCalls += 1;
        return metadataCalls === 1 ? failedResponse() : modelInfo();
      }
      if (url.includes("/resolve/")) return fileResponse();
      throw new Error(`Unexpected fetch ${url}`);
    };
    const { manager, store } = await createHarness(fetchLike);

    await expect(
      run(manager.start({ model_id: "acme/retry-model", destination_dir: "retry" })),
    ).rejects.toThrow();

    const retry = await run(
      manager.start({
        model_id: "acme/retry-model",
        destination_dir: "retry",
      }),
    );
    await waitForStatus(store, retry.id, "completed");
    expect(metadataCalls).toBe(2);
  });

  test.each([
    ["completed", false],
    ["failed", true],
  ] as const)("releases a target after a %s run", async (status, failFirst) => {
    let fileCalls = 0;
    const fetchLike: FetchLike = (url) => {
      if (url.includes("/api/models/")) return modelInfo();
      if (url.includes("/resolve/")) {
        fileCalls += 1;
        if (failFirst && fileCalls === 1) {
          return new Response("failed", { status: 500, statusText: "Server Error" });
        }
        return fileResponse();
      }
      throw new Error(`Unexpected fetch ${url}`);
    };
    const { manager, store } = await createHarness(fetchLike);

    const first = await run(
      manager.start({
        model_id: "acme/terminal-model",
        destination_dir: "terminal",
      }),
    );
    const finished = await waitForStatus(store, first.id, status);
    if (status === "completed") rmSync(join(finished.target_dir, "model.safetensors"));

    const retry = await run(
      manager.start({
        model_id: "acme/terminal-model",
        destination_dir: "terminal",
      }),
    );
    await waitForStatus(store, retry.id, "completed");
    expect(fileCalls).toBe(2);
  });

  test("releases ownership after writer failure", async () => {
    const fetchLike: FetchLike = (url) => {
      if (url.includes("/api/models/")) return modelInfo();
      if (url.includes("/resolve/")) return fileResponse();
      throw new Error(`Unexpected fetch ${url}`);
    };
    const { config, manager, store } = await createHarness(fetchLike);
    const target = join(config.models_dir, "writer-error");
    const partial = join(target, "model.safetensors.part");
    mkdirSync(partial, { recursive: true });

    const started = await run(
      manager.start({
        model_id: "acme/writer-error",
        destination_dir: "writer-error",
      }),
    );
    await waitForStatus(store, started.id, "failed");

    rmSync(partial, { recursive: true });
    await run(manager.resume(started.id));
    await waitForStatus(store, started.id, "completed");
    expect(readFileSync(join(target, "model.safetensors"), "utf8")).toBe("done");
  });

  test("holds ownership until delayed reader cleanup completes after writer failure", async () => {
    const readerCleanup = deferred<void>();
    let bodyCancelStarted = false;
    let bodyCanceled = false;
    let fileCalls = 0;
    const fetchLike: FetchLike = async (url) => {
      if (url.includes("/api/models/")) return modelInfo();
      if (!url.includes("/resolve/")) throw new Error(`Unexpected fetch ${url}`);
      fileCalls += 1;
      if (fileCalls > 1) return fileResponse();
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller): Promise<void> {
            await delay(75);
            if (!bodyCancelStarted) controller.enqueue(new TextEncoder().encode("done"));
          },
          async cancel(): Promise<void> {
            bodyCancelStarted = true;
            await readerCleanup.promise;
            bodyCanceled = true;
          },
        }),
        { status: 200, headers: { "content-length": "4" } },
      );
    };
    const { config, manager, store } = await createHarness(fetchLike);
    const target = join(config.models_dir, "delayed-writer-error");
    const partial = join(target, "model.safetensors.part");
    mkdirSync(partial, { recursive: true });

    const started = await run(
      manager.start({
        model_id: "acme/delayed-writer-error",
        destination_dir: "delayed-writer-error",
      }),
    );
    await waitFor(() => bodyCancelStarted, 1_000);
    await expect(
      run(
        manager.start({
          model_id: "acme/blocked-during-reader-cleanup",
          destination_dir: "delayed-writer-error",
        }),
      ),
    ).rejects.toBeInstanceOf(DownloadTargetConflict);
    expect((await run(store.get(started.id)))?.status).toBe("downloading");

    readerCleanup.resolve();
    await waitForStatus(store, started.id, "failed");
    expect(bodyCanceled).toBe(true);

    rmSync(partial, { recursive: true });
    const retry = await run(
      manager.start({
        model_id: "acme/delayed-writer-error",
        destination_dir: "delayed-writer-error",
      }),
    );
    await waitForStatus(store, retry.id, "completed");
    expect(readFileSync(join(target, "model.safetensors"), "utf8")).toBe("done");
  });

  test("releases active reservations only after shutdown stream cleanup", async () => {
    let firstBodyCanceled = false;
    let fileCalls = 0;
    const fetchLike: FetchLike = (url, init) => {
      if (url.includes("/api/models/")) return modelInfo(8);
      if (!url.includes("/resolve/")) throw new Error(`Unexpected fetch ${url}`);
      fileCalls += 1;
      if (fileCalls === 1) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller): void {
              controller.enqueue(new TextEncoder().encode("half"));
            },
            cancel(): void {
              firstBodyCanceled = true;
            },
          }),
          { status: 200 },
        );
      }
      expect(new Headers(init?.headers).get("Range")).toBe("bytes=4-");
      return new Response("rest", {
        status: 206,
        headers: { "content-length": "4" },
      });
    };
    const { manager, store } = await createHarness(fetchLike);
    const active = await run(
      manager.start({ model_id: "acme/shutdown", destination_dir: "shutdown-target" }),
    );
    const partial = join(active.target_dir, "model.safetensors.part");
    await waitFor(() => existsSync(partial) && statSync(partial).size === 4);

    await run(manager.shutdown());
    expect(firstBodyCanceled).toBe(true);
    const retry = await run(
      manager.start({ model_id: "acme/shutdown-retry", destination_dir: "shutdown-target" }),
    );
    await waitForStatus(store, retry.id, "completed");
    expect(readFileSync(join(retry.target_dir, "model.safetensors"), "utf8")).toBe("halfrest");
  });

  test.each([
    ["pause", "paused"],
    ["cancel", "canceled"],
  ] as const)(
    "%s retains ownership through stream cleanup and preserves Range resume",
    async (action, expectedStatus) => {
      const readerCleanup = deferred<void>();
      let bodyCancelStarted = false;
      const fetchLike: FetchLike = (url, init) => {
        if (url.includes("/api/models/")) return modelInfo(16);
        if (!url.includes("/resolve/")) throw new Error(`Unexpected fetch ${url}`);
        const range = new Headers(init?.headers).get("Range");
        if (range === "bytes=12-") {
          return new Response("rest", {
            status: 206,
            headers: { "content-length": "4" },
          });
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller): void {
              controller.enqueue(new TextEncoder().encode("partial-data"));
            },
            async cancel(): Promise<void> {
              bodyCancelStarted = true;
              await readerCleanup.promise;
            },
          }),
          { status: 200 },
        );
      };
      const { manager, store } = await createHarness(fetchLike);

      const started = await run(manager.start({ model_id: "acme/interrupted-model" }));
      const partial = join(started.target_dir, "model.safetensors.part");
      await waitFor(() => existsSync(partial) && statSync(partial).size === 12);

      const interruption = run(
        action === "pause" ? manager.pause(started.id) : manager.cancel(started.id),
      );
      await waitFor(() => bodyCancelStarted);
      const interrupted = await run(store.get(started.id));
      await expect(run(manager.resume(started.id))).rejects.toBeInstanceOf(DownloadTargetConflict);
      expect(await run(store.get(started.id))).toEqual(interrupted);
      expect(interrupted?.status).toBe(expectedStatus);
      expect(existsSync(partial)).toBe(true);

      readerCleanup.resolve();
      await interruption;
      await resumeWhenAvailable(manager, started.id);
      const completed = await waitForStatus(store, started.id, "completed");
      expect(readFileSync(join(completed.target_dir, "model.safetensors"), "utf8")).toBe(
        "partial-datarest",
      );
      expect(existsSync(partial)).toBe(false);
    },
  );

  test("maps start and resume target races to safe HTTP conflicts", async () => {
    const metadataGate = deferred<void>();
    let metadataCalls = 0;
    const fetchLike: FetchLike = async (url) => {
      if (!url.includes("/api/models/")) throw new Error(`Unexpected fetch ${url}`);
      metadataCalls += 1;
      if (metadataCalls === 1) await metadataGate.promise;
      return Response.json({ sha: "abc123", siblings: [] });
    };
    const { config, manager, root, store } = await createHarness(fetchLike);

    await withEnvironment(
      {
        LOCAL_STUDIO_DATA_DIR: join(root, "app-data"),
        LOCAL_STUDIO_DB_PATH: join(root, "app.db"),
        LOCAL_STUDIO_MODELS_DIR: config.models_dir,
      },
      () =>
        run(
          Effect.scoped(
            Effect.gen(function* () {
              const context = yield* makeAppContext;
              context.downloadManager = manager;
              context.logger = logger;
              const runtime = createControllerRuntime();
              yield* Effect.tryPromise({
                try: async () => {
                  try {
                    const app = createApp(context, runtime);
                    const target = join(config.models_dir, "shared-target");
                    const activeRequest = app.request("/studio/downloads", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        model_id: "https://huggingface.co/acme/url-model",
                        destination_dir: "shared-target",
                        hf_token: "active-secret-token",
                      }),
                    });
                    await waitFor(() => metadataCalls === 1);

                    const now = new Date().toISOString();
                    await run(
                      store.save({
                        id: "recipe-download",
                        model_id: "acme/recipe-model",
                        revision: "abc123",
                        status: "paused",
                        created_at: now,
                        updated_at: now,
                        target_dir: target,
                        total_bytes: 4,
                        downloaded_bytes: 0,
                        files: [
                          {
                            path: "model.safetensors",
                            size_bytes: 4,
                            downloaded_bytes: 0,
                            status: "pending",
                          },
                        ],
                        error: null,
                      }),
                    );

                    const conflictingStart = await app.request("/studio/downloads", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        model_id: "acme/path-model",
                        destination_dir: "shared-target/.",
                        hf_token: "blocked-secret-token",
                      }),
                    });
                    const startDetail = await responseDetail(conflictingStart);
                    expect(conflictingStart.status).toBe(409);
                    expect(startDetail).toContain(target);
                    expect(startDetail).toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/);
                    expect(startDetail).not.toContain("secret-token");
                    expect(metadataCalls).toBe(1);

                    const beforeResume = await run(store.get("recipe-download"));
                    const conflictingResume = await app.request(
                      "/studio/downloads/recipe-download/resume",
                      {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ hf_token: "resume-secret-token" }),
                      },
                    );
                    expect(conflictingResume.status).toBe(409);
                    expect(await responseDetail(conflictingResume)).toBe(startDetail);
                    expect(await run(store.get("recipe-download"))).toEqual(beforeResume);

                    metadataGate.resolve();
                    expect((await activeRequest).status).toBe(500);
                    const released = await app.request("/studio/downloads", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        model_id: "acme/released-model",
                        destination_dir: "shared-target",
                      }),
                    });
                    expect(released.status).toBe(500);
                    expect(metadataCalls).toBe(2);
                  } finally {
                    await runtime.dispose();
                  }
                },
                catch: (cause) => cause,
              });
            }),
          ),
        ),
    );
  });
});
