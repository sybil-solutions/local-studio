import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Hono } from "hono";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppContext } from "../../src/app-context";
import {
  createConfig,
  isWildcardHost,
  normalizeControllerHost,
  normalizeHttpOrigin,
} from "../../src/config/env";
import { delay } from "../../src/core/async";
import { primaryLogPathFor } from "../../src/core/log-files";
import { normalizeRequestAuthority } from "../../src/http/security-middleware";

const ENV_KEYS = [
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_DB_PATH",
  "LOCAL_STUDIO_MODELS_DIR",
  "LOCAL_STUDIO_HOST",
  "LOCAL_STUDIO_PORT",
  "LOCAL_STUDIO_INFERENCE_PORT",
  "LOCAL_STUDIO_MOCK_INFERENCE",
  "LOCAL_STUDIO_MOCK_MODEL_ID",
  "LOCAL_STUDIO_API_KEY",
  "LOCAL_STUDIO_ALLOW_UNAUTHENTICATED",
  "LOCAL_STUDIO_ALLOWED_HOSTS",
  "LOCAL_STUDIO_CORS_ORIGINS",
  "LOCAL_STUDIO_RUNTIME_SKIP_DOCKER",
  "LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM",
  "PI_CODING_AGENT_DIR",
] as const;

type EnvSnapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;

type ControllerRequestRow = {
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  success: number;
  error_class: string | null;
  error_message: string | null;
  user_agent: string | null;
};

let envSnapshot: EnvSnapshot;
let tempDir: string;

beforeEach(() => {
  envSnapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as EnvSnapshot;
  tempDir = mkdtempSync(join(tmpdir(), "local-studio-controller-security-"));
  Object.assign(process.env, {
    LOCAL_STUDIO_DATA_DIR: tempDir,
    LOCAL_STUDIO_DB_PATH: join(tempDir, "controller.db"),
    LOCAL_STUDIO_MODELS_DIR: join(tempDir, "models"),
    LOCAL_STUDIO_HOST: "127.0.0.1",
    LOCAL_STUDIO_PORT: "18080",
    LOCAL_STUDIO_INFERENCE_PORT: "65534",
    LOCAL_STUDIO_MOCK_INFERENCE: "true",
    LOCAL_STUDIO_MOCK_MODEL_ID: "mock-model",
    LOCAL_STUDIO_RUNTIME_SKIP_DOCKER: "1",
    LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM: "1",
    PI_CODING_AGENT_DIR: join(tempDir, "pi-agent"),
  });
  delete process.env.LOCAL_STUDIO_API_KEY;
  delete process.env.LOCAL_STUDIO_ALLOW_UNAUTHENTICATED;
  delete process.env.LOCAL_STUDIO_ALLOWED_HOSTS;
  delete process.env.LOCAL_STUDIO_CORS_ORIGINS;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await delay(50);
  rmSync(tempDir, { recursive: true, force: true });
});

const createTestHarness = async (): Promise<{ app: Hono; context: AppContext }> => {
  const [{ createAppContext }, { createApp }] = await Promise.all([
    import("../../src/app-context"),
    import("../../src/http/app"),
  ]);
  const context = createAppContext();
  return { app: createApp(context), context };
};

const readControllerRequestRows = (): ControllerRequestRow[] => {
  const dbPath = process.env.LOCAL_STUDIO_DB_PATH;
  if (!dbPath) throw new Error("LOCAL_STUDIO_DB_PATH is required for tests");
  const database = new Database(dbPath, { readonly: true });
  try {
    return database
      .query<ControllerRequestRow, []>(
        `SELECT method, path, status, duration_ms, success, error_class, error_message, user_agent
         FROM controller_requests
         ORDER BY id ASC`,
      )
      .all();
  } finally {
    database.close();
  }
};

type GuardRequest = {
  host?: string;
  origin?: string;
  token?: string;
};

const request = (app: Hono, path: string, options: GuardRequest = {}): Promise<Response> => {
  const headers: Record<string, string> = {};
  if (options.host !== undefined) headers.host = options.host;
  if (options.origin !== undefined) headers.origin = options.origin;
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  return app.request(`http://localhost:18080${path}`, { method: "POST", headers });
};

const stubEviction = (context: AppContext): (() => number) => {
  let calls = 0;
  context.engineService.setActiveRecipe = async () => {
    calls += 1;
    return { ok: true };
  };
  return () => calls;
};

const expectForbidden = async (response: Response): Promise<void> => {
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ detail: "Forbidden request origin" });
};

describe("keyless controller request boundary", () => {
  test("rejects hostile origins and rebound authorities before route execution", async () => {
    const { app, context } = await createTestHarness();
    const evictionCalls = stubEviction(context);

    await expectForbidden(
      await request(app, "/evict", {
        host: "localhost:18080",
        origin: "https://attacker.example",
      }),
    );
    await expectForbidden(
      await request(app, "/evict", {
        host: "attacker.example:18080",
        origin: "http://localhost:3000",
      }),
    );

    expect(evictionCalls()).toBe(0);
    expect(readControllerRequestRows()).toEqual([]);
  });

  test("allows canonical loopback and Docker browser origins", async () => {
    const { app, context } = await createTestHarness();
    const evictionCalls = stubEviction(context);
    const cases = [
      ["localhost:18080", "http://localhost:3000"],
      ["127.0.0.1:18080", "http://127.0.0.1:3001"],
      ["[::1]:18080", "http://[::1]:3000"],
      ["host.docker.internal:18080", "http://host.docker.internal:3001"],
    ] as const;

    for (const [host, origin] of cases) {
      const response = await request(app, "/evict", { host, origin });
      expect(response.status).toBe(200);
    }

    expect(evictionCalls()).toBe(cases.length);
  });

  test("allows native clients only through an allowed authority", async () => {
    const { app, context } = await createTestHarness();
    const evictionCalls = stubEviction(context);

    expect((await request(app, "/evict", { host: "127.0.0.1:18080" })).status).toBe(200);
    await expectForbidden(await request(app, "/evict", { host: "attacker.example:18080" }));

    expect(evictionCalls()).toBe(1);
  });

  test("fails closed for malformed origins and authorities", async () => {
    const { app, context } = await createTestHarness();
    const evictionCalls = stubEviction(context);
    const origins = [
      "null",
      "file:///tmp/controller",
      "http://user:pass@localhost:3000",
      "http://localhost:3000/path",
      "not an origin",
    ];
    const zoneAuthority = "[fe80::1%en0]:18080";
    const hosts = [
      "localhost:9999",
      "user@localhost:18080",
      "localhost/path",
      "[::1",
      "::1",
      zoneAuthority,
    ];

    for (const origin of origins) {
      await expectForbidden(await request(app, "/evict", { host: "localhost:18080", origin }));
    }
    for (const host of hosts) {
      await expectForbidden(
        await request(app, "/evict", { host, origin: "http://localhost:3000" }),
      );
    }

    expect(evictionCalls()).toBe(0);
    const logPath = primaryLogPathFor(context.config.data_dir, "controller");
    const logContent = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    expect(logContent).not.toContain(zoneAuthority);
  });

  test("supports a concrete keyless LAN host and configured frontend origin", async () => {
    process.env.LOCAL_STUDIO_HOST = "192.168.1.10";
    process.env.LOCAL_STUDIO_ALLOW_UNAUTHENTICATED = "true";
    process.env.LOCAL_STUDIO_CORS_ORIGINS = "https://studio.lan";
    const { app, context } = await createTestHarness();
    const evictionCalls = stubEviction(context);

    const response = await request(app, "/evict", {
      host: "192.168.1.10:18080",
      origin: "https://studio.lan",
    });

    expect(response.status).toBe(200);
    await expectForbidden(
      await request(app, "/evict", {
        host: "192.168.1.10:18080",
        origin: "https://attacker.example",
      }),
    );
    await expectForbidden(
      await request(app, "/evict", {
        host: "attacker.example:18080",
        origin: "https://studio.lan",
      }),
    );
    expect(context.config.allowed_hosts).toEqual(["192.168.1.10"]);
    expect(evictionCalls()).toBe(1);
  });

  test("requires explicit authorities for keyless wildcard binds", () => {
    process.env.LOCAL_STUDIO_ALLOW_UNAUTHENTICATED = "true";
    delete process.env.LOCAL_STUDIO_ALLOWED_HOSTS;

    for (const host of ["0.0.0.0", "::", "0", "0x0", "00.00.00.00", "0.0.0.00"]) {
      process.env.LOCAL_STUDIO_HOST = host;
      expect(() => createConfig()).toThrow(
        "LOCAL_STUDIO_ALLOWED_HOSTS is required for a keyless wildcard controller bind",
      );
    }
  });

  test("enforces explicit authorities on a keyless wildcard bind", async () => {
    process.env.LOCAL_STUDIO_HOST = "0.0.0.0";
    process.env.LOCAL_STUDIO_ALLOW_UNAUTHENTICATED = "true";
    process.env.LOCAL_STUDIO_ALLOWED_HOSTS = "studio.lan,192.168.1.10";
    process.env.LOCAL_STUDIO_CORS_ORIGINS = "https://studio.lan";
    const { app, context } = await createTestHarness();
    const evictionCalls = stubEviction(context);

    expect(
      (
        await request(app, "/evict", {
          host: "studio.lan:18080",
          origin: "https://studio.lan",
        })
      ).status,
    ).toBe(200);
    await expectForbidden(
      await request(app, "/evict", {
        host: "attacker.example:18080",
        origin: "https://studio.lan",
      }),
    );
    await expectForbidden(
      await request(app, "/evict", {
        host: "studio.lan:18080",
        origin: "https://attacker.example",
      }),
    );

    expect(evictionCalls()).toBe(1);
  });

  test("enforces explicit authorities on an IPv6 wildcard bind", async () => {
    process.env.LOCAL_STUDIO_HOST = "::";
    process.env.LOCAL_STUDIO_ALLOW_UNAUTHENTICATED = "true";
    process.env.LOCAL_STUDIO_ALLOWED_HOSTS = "::1,studio-v6.lan";
    process.env.LOCAL_STUDIO_CORS_ORIGINS = "http://[::1]:3000";
    const { app, context } = await createTestHarness();
    const evictionCalls = stubEviction(context);

    expect(
      (
        await request(app, "/evict", {
          host: "[::1]:18080",
          origin: "http://[::1]:3000",
        })
      ).status,
    ).toBe(200);
    await expectForbidden(
      await request(app, "/evict", {
        host: "attacker.example:18080",
        origin: "http://[::1]:3000",
      }),
    );
    await expectForbidden(
      await request(app, "/evict", {
        host: "[::1]:18080",
        origin: "https://attacker.example",
      }),
    );

    expect(evictionCalls()).toBe(1);
  });

  test("rejects malformed explicit authority configuration", () => {
    process.env.LOCAL_STUDIO_HOST = "0.0.0.0";
    process.env.LOCAL_STUDIO_ALLOW_UNAUTHENTICATED = "true";

    for (const value of [
      "http://studio.lan",
      "studio.lan:8080",
      "user@studio.lan",
      "*.studio.lan",
      "0.0.0.0",
      "0",
      "0x0",
      "studio.lan,",
    ]) {
      process.env.LOCAL_STUDIO_ALLOWED_HOSTS = value;
      expect(() => createConfig()).toThrow("LOCAL_STUDIO_ALLOWED_HOSTS must contain");
    }
  });

  test("leaves API-key-protected remote behavior unchanged", async () => {
    process.env.LOCAL_STUDIO_HOST = "localhost.";
    process.env.LOCAL_STUDIO_API_KEY = "controller-secret";
    const { app, context } = await createTestHarness();
    const evictionCalls = stubEviction(context);

    const response = await request(app, "/evict", {
      host: "attacker.example:18080",
      origin: "https://attacker.example",
      token: "controller-secret",
    });
    const health = await app.request("http://attacker.example:18080/health");

    expect(response.status).toBe(200);
    expect(health.status).toBe(200);
    expect(context.config.host).toBe("localhost.");
    expect(context.config.allowed_hosts).toBeUndefined();
    expect(evictionCalls()).toBe(1);
  });

  test("keeps allowed health checks public while rejecting rebound health requests", async () => {
    const { app } = await createTestHarness();

    expect((await app.request("http://localhost:18080/health")).status).toBe(200);
    expect(
      (
        await app.request("http://localhost:18080/health", {
          headers: { host: "attacker.example:18080" },
        })
      ).status,
    ).toBe(403);
  });
});

describe("authority normalization", () => {
  test("normalizes exact host and origin forms", () => {
    expect(normalizeControllerHost("LOCALHOST")).toBe("localhost");
    expect(normalizeControllerHost("[0:0:0:0:0:0:0:1]")).toBe("::1");
    expect(normalizeControllerHost("0x0")).toBe("0.0.0.0");
    expect(normalizeControllerHost("0177.1")).toBe("127.0.0.1");
    expect(isWildcardHost("00.00.00.00")).toBe(true);
    expect(normalizeRequestAuthority("[::1]:18080", 18080)).toBe("::1");
    expect(normalizeRequestAuthority("LOCALHOST", 18080)).toBe("localhost");
    expect(normalizeHttpOrigin("HTTPS://STUDIO.LAN/")).toBe("https://studio.lan");
  });

  test("rejects ports, credentials, wildcards, and non-HTTP origins", () => {
    expect(normalizeControllerHost("studio.lan:8080")).toBeNull();
    expect(normalizeControllerHost("*.studio.lan")).toBeNull();
    expect(normalizeControllerHost("fe80::1%en0")).toBeNull();
    expect(normalizeRequestAuthority("localhost:8080", 18080)).toBeNull();
    expect(normalizeRequestAuthority("user@localhost:18080", 18080)).toBeNull();
    expect(normalizeHttpOrigin("data:text/plain,hello")).toBeNull();
    expect(normalizeHttpOrigin("https://user@studio.lan")).toBeNull();
  });
});
