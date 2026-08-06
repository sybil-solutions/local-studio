import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppContext } from "../src/app-context";
import { AppContextService } from "../src/app-context";
import { createConfig } from "../src/config/env";
import {
  decodeAllowedHosts,
  isWildcardHost,
  normalizeControllerHost,
  normalizeHttpOrigin,
  normalizeRequestAuthority,
} from "../src/config/request-authority";
import { createControllerRuntime, type ControllerRuntime } from "../src/core/effect-runtime";
import { createApp } from "../src/http/app";

const environmentKeys = [
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_DB_PATH",
  "LOCAL_STUDIO_MODELS_DIR",
  "LOCAL_STUDIO_HOST",
  "LOCAL_STUDIO_PORT",
  "LOCAL_STUDIO_API_KEY",
  "LOCAL_STUDIO_ALLOW_UNAUTHENTICATED",
  "LOCAL_STUDIO_ALLOWED_HOSTS",
  "LOCAL_STUDIO_CORS_ORIGINS",
  "LOCAL_STUDIO_INFERENCE_PORT",
  "LOCAL_STUDIO_DISABLE_METRICS",
] as const;

type EnvironmentKey = (typeof environmentKeys)[number];
type GuardRequest = { host?: string; origin?: string };

const previousEnvironment = new Map<EnvironmentKey, string | undefined>();
let temporaryDirectory = "";
let runtime: ControllerRuntime;
let guardedContext: AppContext;
let app: ReturnType<typeof createApp>;
let evictCalls = 0;
let requestLogCalls = 0;

const resetSecurityEnvironment = (): void => {
  process.env["LOCAL_STUDIO_HOST"] = "127.0.0.1";
  process.env["LOCAL_STUDIO_PORT"] = "18080";
  delete process.env["LOCAL_STUDIO_API_KEY"];
  delete process.env["LOCAL_STUDIO_ALLOW_UNAUTHENTICATED"];
  delete process.env["LOCAL_STUDIO_ALLOWED_HOSTS"];
  delete process.env["LOCAL_STUDIO_CORS_ORIGINS"];
};

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "local-studio-request-authority-"));
  for (const key of environmentKeys) previousEnvironment.set(key, process.env[key]);
  process.env["LOCAL_STUDIO_DATA_DIR"] = temporaryDirectory;
  process.env["LOCAL_STUDIO_DB_PATH"] = join(temporaryDirectory, "controller.db");
  process.env["LOCAL_STUDIO_MODELS_DIR"] = join(temporaryDirectory, "models");
  process.env["LOCAL_STUDIO_INFERENCE_PORT"] = "65534";
  process.env["LOCAL_STUDIO_DISABLE_METRICS"] = "true";
  resetSecurityEnvironment();
  runtime = createControllerRuntime();
  const context = await runtime.runPromise(AppContextService);
  guardedContext = {
    ...context,
    logger: {
      ...context.logger,
      debug: (): void => {
        requestLogCalls += 1;
      },
    },
    bridge: {
      ...context.bridge,
      evict: () =>
        Effect.sync(() => {
          evictCalls += 1;
          return true;
        }),
    },
  } satisfies AppContext;
  app = createApp(guardedContext, runtime);
});

beforeEach(() => {
  resetSecurityEnvironment();
});

afterAll(async () => {
  await runtime.dispose();
  for (const key of environmentKeys) {
    const value = previousEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

const requestEviction = async (options: GuardRequest = {}, target = app): Promise<Response> => {
  const headers = new Headers();
  if (options.host !== undefined) headers.set("host", options.host);
  if (options.origin !== undefined) headers.set("origin", options.origin);
  return target.request("http://localhost:18080/evict", { method: "POST", headers });
};

const expectForbidden = async (response: Response): Promise<void> => {
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ detail: "Forbidden request origin" });
};

describe("request authority normalization", () => {
  test("canonicalizes hostname, IP, authority, and HTTP origins", () => {
    expect(normalizeControllerHost(" LOCALHOST ")).toBe("localhost");
    expect(normalizeControllerHost("[2001:0DB8::1]")).toBe("2001:db8::1");
    expect(normalizeControllerHost("0x7f000001")).toBe("127.0.0.1");
    expect(normalizeRequestAuthority("[::1]:18080", 18080)).toBe("::1");
    expect(normalizeRequestAuthority("studio.lan", 18080)).toBe("studio.lan");
    expect(normalizeHttpOrigin("HTTPS://STUDIO.LAN:443/")).toBe("https://studio.lan");
  });

  test("rejects ambiguous hosts, mismatched ports, and non-HTTP origins", () => {
    for (const value of ["localhost.", "*.example", "user@localhost", "localhost/path"]) {
      expect(normalizeControllerHost(value)).toBeNull();
    }
    for (const value of ["localhost:9999", "::1", "[::1", "0.0.0.0:18080"]) {
      expect(normalizeRequestAuthority(value, 18080)).toBeNull();
    }
    for (const value of [
      "null",
      "file:///tmp/controller",
      "http://user:pass@localhost:3000",
      "http://localhost:3000/path",
    ]) {
      expect(normalizeHttpOrigin(value)).toBeNull();
    }
  });

  test("schema-validates and normalizes exact allowed hosts", () => {
    expect(decodeAllowedHosts("LOCALHOST, [::1],192.168.1.10")).toEqual([
      "localhost",
      "::1",
      "192.168.1.10",
    ]);
    for (const value of [
      "",
      "http://studio.lan",
      "user@studio.lan",
      "studio.lan/path",
      "*.studio.lan",
      "0.0.0.0",
      "studio.lan,",
    ]) {
      expect(() => decodeAllowedHosts(value)).toThrow("LOCAL_STUDIO_ALLOWED_HOSTS must contain");
    }
  });
});

describe("keyless controller boundary", () => {
  test("rejects hostile authority and origin before logging or route execution", async () => {
    const evictionsBefore = evictCalls;
    const logsBefore = requestLogCalls;
    await expectForbidden(
      await requestEviction({
        host: "localhost:18080",
        origin: "https://attacker.example",
      }),
    );
    await expectForbidden(
      await requestEviction({
        host: "attacker.example:18080",
        origin: "http://localhost:3000",
      }),
    );
    expect(evictCalls).toBe(evictionsBefore);
    expect(requestLogCalls).toBe(logsBefore);
  });

  test("allows configured browser and native loopback authorities", async () => {
    const evictionsBefore = evictCalls;
    const cases = [
      { host: "localhost:18080", origin: "http://localhost:3000" },
      { host: "127.0.0.1:18080", origin: "http://127.0.0.1:3001" },
      { host: "[::1]:18080", origin: "http://[::1]:3000" },
      { host: "host.docker.internal:18080", origin: "http://host.docker.internal:3001" },
      { host: "127.0.0.1:18080" },
    ];
    for (const entry of cases) expect((await requestEviction(entry)).status).toBe(200);
    expect(evictCalls - evictionsBefore).toBe(cases.length);
  });

  test("fails closed for malformed request values", async () => {
    const evictionsBefore = evictCalls;
    const cases = [
      { host: "localhost:9999", origin: "http://localhost:3000" },
      { host: "user@localhost:18080", origin: "http://localhost:3000" },
      { host: "::1", origin: "http://[::1]:3000" },
      { host: "localhost:18080", origin: "null" },
      { host: "localhost:18080", origin: "file:///tmp/controller" },
      { host: "localhost:18080", origin: "http://localhost:3000/path" },
    ];
    for (const entry of cases) await expectForbidden(await requestEviction(entry));
    expect(evictCalls).toBe(evictionsBefore);
  });

  test("derives exact LAN defaults and requires wildcard authorities", () => {
    process.env["LOCAL_STUDIO_HOST"] = "Studio.LAN";
    process.env["LOCAL_STUDIO_ALLOW_UNAUTHENTICATED"] = "true";
    process.env["LOCAL_STUDIO_CORS_ORIGINS"] = "HTTPS://STUDIO.LAN:443";
    const lanConfig = createConfig();
    expect(lanConfig.allowed_hosts).toEqual(["studio.lan"]);
    expect(lanConfig.cors_origins).toEqual(["https://studio.lan"]);

    for (const host of ["0.0.0.0", "::", "0", "0x0"]) {
      process.env["LOCAL_STUDIO_HOST"] = host;
      expect(isWildcardHost(host)).toBe(true);
      expect(() => createConfig()).toThrow(
        "LOCAL_STUDIO_ALLOWED_HOSTS is required for a keyless wildcard controller bind",
      );
    }

    process.env["LOCAL_STUDIO_HOST"] = "0.0.0.0";
    process.env["LOCAL_STUDIO_ALLOWED_HOSTS"] = "studio.lan,192.168.1.10";
    expect(createConfig().allowed_hosts).toEqual(["studio.lan", "192.168.1.10"]);
  });

  test("enforces concrete and wildcard LAN authority lists", async () => {
    const evictionsBefore = evictCalls;
    process.env["LOCAL_STUDIO_HOST"] = "192.168.1.10";
    process.env["LOCAL_STUDIO_ALLOW_UNAUTHENTICATED"] = "true";
    process.env["LOCAL_STUDIO_CORS_ORIGINS"] = "https://studio.lan";
    const lanApp = createApp({ ...guardedContext, config: createConfig() }, runtime);
    expect(
      (await requestEviction({ host: "192.168.1.10:18080", origin: "https://studio.lan" }, lanApp))
        .status,
    ).toBe(200);
    await expectForbidden(
      await requestEviction(
        { host: "attacker.example:18080", origin: "https://studio.lan" },
        lanApp,
      ),
    );

    process.env["LOCAL_STUDIO_HOST"] = "0.0.0.0";
    process.env["LOCAL_STUDIO_ALLOWED_HOSTS"] = "studio.lan";
    const wildcardApp = createApp({ ...guardedContext, config: createConfig() }, runtime);
    expect(
      (
        await requestEviction(
          { host: "studio.lan:18080", origin: "https://studio.lan" },
          wildcardApp,
        )
      ).status,
    ).toBe(200);
    expect(evictCalls - evictionsBefore).toBe(2);
  });
});
