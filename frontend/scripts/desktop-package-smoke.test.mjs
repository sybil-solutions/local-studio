import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  allocateLoopbackPort,
  assertNativeExecutableArchitecture,
  cleanupSmoke,
  createBoundedOutput,
  createCdpSession,
  createLifecycleDeadline,
  createLoopbackRecorder,
  createResourceScope,
  emergencyCleanupSmoke,
  executableArchitectures,
  executeSmokeLifecycle,
  formatSmokeDiagnostics,
  isolatedEnvironment,
  parseEmbeddedPort,
  prepareSmokeContext,
  resolvePackagedExecutable,
  resolveSmokeArchitecture,
  sanitizeDiagnostics,
  smokeControllerUrl,
  validateDesktopHealth,
  validatePtyEvaluation,
  waitForDesktopHealth,
  waitForEmbeddedPort,
  waitForPageTarget,
} from "./desktop-package-smoke.mjs";
import { electronBuilderArguments, smokeBuildEnvironment } from "./desktop-package-smoke-pack.mjs";

function fakeClock() {
  let elapsed = 0;
  return {
    delay: async (duration) => {
      elapsed += duration;
    },
    now: () => elapsed,
  };
}

function missingFile() {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function classifiedChunks(chunks) {
  const output = createBoundedOutput(1_024);
  for (const chunk of chunks) output.stdout(chunk);
  return output.snapshot().stdout;
}

function delayedLoopbackServer(port = 49_152) {
  let completeListen;
  let listening = false;
  let closes = 0;
  const server = {
    address: () => (listening ? { port } : null),
    close: (complete) => {
      closes += 1;
      listening = false;
      complete?.();
    },
    closeAllConnections: () => {},
    get listening() {
      return listening;
    },
    listen: (_options, complete) => {
      completeListen = complete;
    },
    once: () => {},
    unref: () => {},
  };
  return {
    closeCount: () => closes,
    completeListen: () => {
      listening = true;
      completeListen();
    },
    server,
  };
}

test("resolves the packaged executable for each supported platform", () => {
  const outputDirectory = "/repo/frontend/dist-desktop";
  const expected = {
    darwin: join(
      outputDirectory,
      "mac-arm64",
      "Local Studio.app",
      "Contents",
      "MacOS",
      "Local Studio",
    ),
    linux: join(outputDirectory, "linux-arm64-unpacked", "local-studio"),
    win32: join(outputDirectory, "win-arm64-unpacked", "Local Studio.exe"),
  };
  for (const [platform, executable] of Object.entries(expected)) {
    assert.equal(
      resolvePackagedExecutable({
        arch: "arm64",
        exists: (candidate) => candidate === executable,
        outputDirectory,
        platform,
      }),
      executable,
    );
  }
  assert.throws(
    () =>
      resolvePackagedExecutable({
        arch: "arm64",
        exists: () => false,
        outputDirectory,
        platform: "darwin",
      }),
    /Packaged desktop executable not found/,
  );
});

test("aligns package output with the hosted runner architecture", () => {
  assert.equal(
    resolveSmokeArchitecture({ runnerArchitecture: "ARM64", processArchitecture: "arm64" }),
    "arm64",
  );
  assert.equal(
    resolveSmokeArchitecture({ runnerArchitecture: "X64", processArchitecture: "x64" }),
    "x64",
  );
  assert.deepEqual(electronBuilderArguments("arm64"), [
    "--dir",
    "--config",
    "desktop/electron-builder.yml",
    "-c.mac.identity=null",
    "-c.mac.hardenedRuntime=false",
    "--arm64",
  ]);
  assert.throws(
    () => resolveSmokeArchitecture({ runnerArchitecture: "ARM64", processArchitecture: "x64" }),
    /does not match Node.js architecture/,
  );
  assert.throws(
    () => resolveSmokeArchitecture({ runnerArchitecture: "RISCV64", processArchitecture: "x64" }),
    /Unsupported desktop smoke runner architecture/,
  );
});

test("rejects a packaged Mach-O that cannot execute on the runner", async () => {
  const arm64 = Buffer.alloc(32);
  arm64.writeUInt32LE(0xfeedfacf, 0);
  arm64.writeUInt32LE(0x0100000c, 4);
  const x64 = Buffer.alloc(32);
  x64.writeUInt32LE(0xfeedfacf, 0);
  x64.writeUInt32LE(0x01000007, 4);
  assert.deepEqual(executableArchitectures(arm64, "darwin"), ["arm64"]);
  assert.deepEqual(
    await assertNativeExecutableArchitecture({
      architecture: "arm64",
      executable: "/tmp/Local Studio",
      platform: "darwin",
      read: async () => arm64,
    }),
    ["arm64"],
  );
  await assert.rejects(
    assertNativeExecutableArchitecture({
      architecture: "arm64",
      executable: "/tmp/Local Studio",
      platform: "darwin",
      read: async () => x64,
    }),
    /architectures x64 do not include runner architecture arm64/,
  );
});

test("accepts only a valid persisted embedded frontend port", () => {
  assert.equal(parseEmbeddedPort("49152\n"), 49152);
  for (const value of ["", "1024", "65536", "12.5", "1234x"]) {
    assert.throws(() => parseEmbeddedPort(value), /Malformed embedded frontend port/);
  }
});

test("requires the documented healthy desktop response", () => {
  assert.deepEqual(validateDesktopHealth(200, { ok: true, ts: 42 }), { ok: true, ts: 42 });
  assert.throws(() => validateDesktopHealth(503, { ok: true, ts: 42 }), /status 503/);
  for (const payload of [null, {}, { ok: false, ts: 42 }, { ok: true, ts: "42" }]) {
    assert.throws(() => validateDesktopHealth(200, payload), /unhealthy JSON/);
  }
});

test("requires the preload terminal bridge and native PTY availability", () => {
  assert.deepEqual(
    validatePtyEvaluation({
      result: { value: { bridgeAvailable: true, status: { available: true } } },
    }),
    { available: true },
  );
  assert.throws(
    () => validatePtyEvaluation({ result: { value: { bridgeAvailable: false } } }),
    /preload bridge is missing/,
  );
  assert.throws(
    () =>
      validatePtyEvaluation({
        result: {
          value: {
            bridgeAvailable: true,
            status: { available: false, reason: "native module missing" },
          },
        },
      }),
    /native PTY is unavailable: native module missing/,
  );
  assert.throws(
    () => validatePtyEvaluation({ exceptionDetails: { text: "evaluation failed" } }),
    /terminal bridge evaluation failed/,
  );
});

test("bounds and fail-closed redacts packaged child diagnostics", () => {
  const output = createBoundedOutput(8);
  output.stdout("012345");
  output.stdout("6789");
  output.stderr("abcdefghij");
  assert.deepEqual(output.snapshot(), { stderr: "cdefghij", stdout: "23456789" });
  assert.equal(
    sanitizeDiagnostics("Authorization: Bearer abc token=private sk-secret"),
    "[redacted diagnostic line]",
  );
});

test("drops adversarial environment, header, URL, provider, and multiline secrets", () => {
  const secrets = [
    "aws-secret-value-unknown-to-the-sanitizer",
    "cookie-session-value",
    "basic-credential-value",
    "url-password-value",
    "query-secret-value",
    "multiline-first",
    "multiline-second",
    "provider-secret-value",
    "unknown-client-value",
    "ghp_provider_token_value",
    "cookie-header-value",
    "proxy-auth-value",
    "x-api-key-value",
    "xoxb-provider-token-value",
    "private-key-body-value",
    "fragment-token-value",
    "command-flag-value",
    "folded-secret-continuation",
  ];
  const report = sanitizeDiagnostics(
    [
      `AWS_SECRET_ACCESS_KEY=${secrets[0]}`,
      `COOKIE=${secrets[1]}`,
      `Authorization: Basic ${secrets[2]}`,
      `https://user:${secrets[3]}@production.example/v1`,
      `https://production.example/v1?client_secret=${secrets[4]}`,
      `client_secret="${secrets[5]}`,
      `${secrets[6]}"`,
      `OPENAI_API_KEY=${secrets[7]}`,
      `{"client_secret":"${secrets[8]}"}`,
      secrets[9],
      `Cookie: session=${secrets[10]}`,
      `Proxy-Authorization: Bearer ${secrets[11]}`,
      `X-Api-Key: ${secrets[12]}`,
      secrets[13],
      "-----BEGIN PRIVATE KEY-----",
      secrets[14],
      "-----END PRIVATE KEY-----",
      `https://production.example/callback#access_token=${secrets[15]}`,
      `command --api-key ${secrets[16]}`,
      "AWS_SECRET_ACCESS_KEY=first\\",
      secrets[17],
      "safe diagnostic line",
      "😀".repeat(40_000),
    ].join("\n"),
  );
  for (const secret of secrets) assert.equal(report.includes(secret), false);
  assert.match(report, /safe diagnostic line/);
  assert.ok(Buffer.byteLength(report) <= 32_768);
});

test("redacts next-line secret values and product provider tokens", () => {
  const secrets = [
    "opaque-next-line-value",
    "opaque-cookie-value",
    "hf_abcdefghijklmnopqrstuvwxyzABCDEFGH123456",
    "gsk_abcdefghijklmnopqrstuvwxyzABCDEFGH123456",
  ];
  const report = sanitizeDiagnostics(
    [
      '"client_secret":',
      `  "${secrets[0]}"`,
      "Cookie:",
      `  sessionid=${secrets[1]}`,
      secrets[2],
      secrets[3],
      "safe diagnostic line",
    ].join("\n"),
  );
  for (const secret of secrets) assert.equal(report.includes(secret), false);
  assert.match(report, /safe diagnostic line/);
});

test("redacts multiline secrets before retaining the bounded output tail", () => {
  const marker = "opaque-private-body-marker";
  const output = createBoundedOutput(128);
  output.stdout(
    `-----BEGIN PRIVATE KEY-----\n${marker}${"A".repeat(40)}\n${"z".repeat(50)}`,
  );
  const report = output.snapshot().stdout;
  assert.equal(report.includes("BEGIN PRIVATE KEY"), false);
  assert.equal(report.includes(marker), false);
});

test("redacts inline sensitive headers and every folded continuation across chunks", () => {
  const secrets = [
    "inline-authorization-value",
    "first-folded-authorization-value",
    "second-folded-authorization-value",
    "inline-cookie-value",
    "first-folded-cookie-value",
    "second-folded-cookie-value",
  ];
  const output = createBoundedOutput(256);
  output.stdout(`${"x".repeat(300)}\nAuthor`);
  output.stdout(`ization: Bearer ${secrets[0]}\r\n\t${secrets[1]}`);
  output.stdout(`\r\n ${secrets[2]}\r\nCook`);
  output.stdout(`ie: session=${secrets[3]}\r\n\t${secrets[4]}\r`);
  output.stdout(`\n ${secrets[5]}\r\nsafe diagnostic tail\n`);
  const report = output.snapshot().stdout;
  for (const secret of secrets) assert.equal(report.includes(secret), false);
  assert.match(report, /safe diagnostic tail/);
  assert.ok(Buffer.byteLength(report) <= 256);
});

test("classifies an oversized unterminated line after output retention is exhausted", () => {
  const secrets = ["late-inline-secret", "late-folded-secret"];
  const output = createBoundedOutput(64);
  output.stdout("x".repeat(257));
  output.stdout("Author");
  output.stdout(`ization: Bearer ${secrets[0]}\n\t${secrets[1]}\nsafe tail\n`);
  const report = output.snapshot().stdout;
  for (const secret of secrets) assert.equal(report.includes(secret), false);
  assert.match(report, /safe tail/);
  assert.ok(Buffer.byteLength(report) <= 64);
});

test("classifies boundary-crossing markers in every raw diagnostic chunk", () => {
  const secret = "boundary-folded-secret";
  const output = createBoundedOutput(64);
  output.stderr(`${"x".repeat(252)}Author`);
  output.stderr(`ization: Bearer inline-secret\n ${secret}\nsafe boundary tail`);
  const report = output.snapshot().stderr;
  assert.equal(report.includes(secret), false);
  assert.match(report, /safe boundary tail/);
});

test("classifies complete error stacks before bounding the sanitized report", () => {
  const error = new Error("failure");
  const secret = "late-stack-folded-secret";
  error.stack = `${"frame ".repeat(2_000)}\nAuthorization: Bearer inline-secret\n\t${secret}\nsafe stack tail`;
  const report = formatSmokeDiagnostics(error, {
    snapshot: () => ({ stderr: "", stdout: "" }),
  });
  assert.equal(report.includes(secret), false);
  assert.match(report, /safe stack tail/);
});

test("normalizes diagnostic controls before classifying single and split buffers", () => {
  const cases = [
    ["API_\rKEY=opaque-api-key", "opaque-api-key"],
    ["TO\0KEN=opaque-token", "opaque-token"],
    ["--api-\rkey opaque-flag", "opaque-flag"],
  ];
  for (const [source, secret] of cases) {
    assert.equal(sanitizeDiagnostics(`${source}\nsafe tail`).includes(secret), false);
    const split = source.indexOf("\r") === -1 ? source.indexOf("\0") : source.indexOf("\r");
    const report = classifiedChunks([
      Buffer.from(source.slice(0, split)),
      Buffer.from(source.slice(split, split + 1)),
      Buffer.from(`${source.slice(split + 1)}\nsafe tail`),
    ]);
    assert.equal(report.includes(secret), false);
    assert.match(report, /safe tail/);
  }
});

test("preserves CRLF and folded diagnostic state across NUL and lone CR controls", () => {
  const secrets = ["opaque-nul-folded", "opaque-cr-folded"];
  for (const source of [
    `TOKEN: |\n\0  ${secrets[0]}\nsafe folded tail`,
    `TOKEN: |\n\r  ${secrets[1]}\nsafe folded tail`,
  ]) {
    const report = sanitizeDiagnostics(source);
    for (const secret of secrets) assert.equal(report.includes(secret), false);
    assert.match(report, /safe folded tail/);
  }
  const chunkedFolded = classifiedChunks([
    Buffer.from("TOKEN: |\n\r"),
    Buffer.from(`  ${secrets[1]}\nsafe folded tail`),
  ]);
  assert.equal(chunkedFolded.includes(secrets[1]), false);
  assert.match(chunkedFolded, /safe folded tail/);
  assert.equal(
    classifiedChunks([Buffer.from("safe first\r"), Buffer.from("\nsafe second")]),
    "safe first\nsafe second",
  );
  assert.equal(sanitizeDiagnostics("safe\0separator"), "safe separator");
  assert.equal(classifiedChunks(["safe\r", "separator"]), "safe separator");
});

test("build and runtime environments cannot inherit controller routes or credentials", () => {
  const source = {
    API_KEY: "production-api-key",
    AWS_SECRET_ACCESS_KEY: "production-aws-secret",
    BACKEND_URL: "https://production.example",
    COMSPEC: "/tmp/host-controlled-command-shell",
    HOME: "/real/home",
    INFERENCE_API_KEY: "production-inference-key",
    LOCAL_STUDIO_API_KEY: "production-local-studio-key",
    LOCAL_STUDIO_BACKEND_URL: "https://production.example",
    NEXT_PUBLIC_API_URL: "https://production.example",
    NEXT_PUBLIC_BACKEND_URL: "https://production.example",
    PATH: "/safe/bin",
    SHELL: "/tmp/host-controlled-shell",
  };
  const context = {
    controllerSink: { url: "http://127.0.0.1:49152" },
    cwd: "/isolated/cwd",
    data: "/isolated/data",
    home: "/isolated/home",
    temporary: "/isolated/tmp",
    userData: "/isolated/user-data",
  };
  const runtime = isolatedEnvironment(context, source);
  for (const name of [
    "BACKEND_URL",
    "LOCAL_STUDIO_BACKEND_URL",
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_BACKEND_URL",
  ]) {
    assert.equal(runtime[name], context.controllerSink.url);
  }
  for (const name of ["API_KEY", "INFERENCE_API_KEY", "LOCAL_STUDIO_API_KEY"]) {
    assert.equal(runtime[name], "");
  }
  assert.equal(runtime.HOME, context.home);
  assert.equal(runtime.PATH, source.PATH);
  assert.equal("COMSPEC" in runtime, false);
  assert.equal("SHELL" in runtime, false);
  assert.equal("AWS_SECRET_ACCESS_KEY" in runtime, false);
  assert.equal(Object.values(runtime).includes("https://production.example"), false);

  const build = smokeBuildEnvironment(source);
  for (const name of [
    "BACKEND_URL",
    "LOCAL_STUDIO_BACKEND_URL",
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_BACKEND_URL",
  ]) {
    assert.equal(build[name], smokeControllerUrl);
  }
  assert.equal("AWS_SECRET_ACCESS_KEY" in build, false);
  assert.equal("COMSPEC" in build, false);
  assert.equal("SHELL" in build, false);
  assert.equal(Object.values(build).includes("https://production.example"), false);
});

test("routes hostile controller defaults only to the credential-free smoke sink", async () => {
  const closed = [];
  const recorder = (name, url) => ({
    close: async () => closed.push(name),
    snapshot: () => ({ credentialSignals: [], requestCount: 0 }),
    url,
  });
  const controllerSink = recorder("sink", "http://127.0.0.1:49152");
  const productionSentinel = recorder("sentinel", "http://127.0.0.1:49153");
  const context = {
    controllerSink,
    cwd: "/isolated/cwd",
    data: "/isolated/data",
    home: "/isolated/home",
    productionSentinel,
    temporary: "/isolated/tmp",
    userData: "/isolated/user-data",
  };
  const source = {
    API_KEY: "sentinel-key",
    BACKEND_URL: productionSentinel.url,
    LOCAL_STUDIO_API_KEY: "sentinel-key",
    NEXT_PUBLIC_BACKEND_URL: productionSentinel.url,
  };
  const environment = isolatedEnvironment(context, source);
  assert.equal(environment.BACKEND_URL, controllerSink.url);
  assert.equal(Object.values(environment).includes(productionSentinel.url), false);
  assert.deepEqual(productionSentinel.snapshot(), { credentialSignals: [], requestCount: 0 });
  await cleanupSmoke({ context }, { remove: async () => {} });
  assert.deepEqual(closed, ["sentinel", "sink"]);
});

test("records only controller contact counts and credential signal names", async () => {
  let requestHandler;
  let closed = false;
  const server = {
    address: () => ({ port: 49152 }),
    close: (complete) => {
      closed = true;
      server.listening = false;
      complete();
    },
    closeAllConnections: () => {},
    listen: (_options, ready) => {
      server.listening = true;
      ready();
    },
    listening: false,
    once: () => {},
  };
  const recorder = await createLoopbackRecorder({
    createServer: (handler) => {
      requestHandler = handler;
      return server;
    },
  });
  let responseBody;
  requestHandler(
    {
      headers: { authorization: "credential-value", cookie: "session-value" },
      resume: () => {},
      url: "/v1/status?client_secret=query-value",
    },
    {
      end: (body) => {
        responseBody = body;
      },
      writeHead: () => {},
    },
  );
  assert.deepEqual(recorder.snapshot(), {
    credentialSignals: ["authorization", "cookie", "sensitive-query"],
    requestCount: 1,
  });
  assert.equal(JSON.stringify(recorder.snapshot()).includes("credential-value"), false);
  assert.equal(responseBody, '{"ok":false}');
  await recorder.close();
  assert.equal(closed, true);
});

test("closes a recorder whose listener completes after abort", async () => {
  const delayed = delayedLoopbackServer();
  const controller = new AbortController();
  const scope = createResourceScope();
  const pending = createLoopbackRecorder({
    createServer: () => delayed.server,
    resourceScope: scope,
    signal: controller.signal,
  });
  controller.abort(new Error("listener deadline lost"));
  scope.emergencyReleaseAll();
  await assert.rejects(pending, /listener deadline lost/);
  delayed.completeListen();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delayed.server.listening, false);
  assert.equal(delayed.closeCount(), 1);
});

test("closes a port server whose listener completes after scope closure", async () => {
  const delayed = delayedLoopbackServer();
  const scope = createResourceScope();
  const pending = allocateLoopbackPort(undefined, scope, () => delayed.server);
  scope.emergencyReleaseAll();
  delayed.completeListen();
  await assert.rejects(pending, /Loopback listener aborted/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delayed.server.listening, false);
  assert.equal(delayed.closeCount(), 1);
});

test("recognizes every sensitive controller header without retaining values", async () => {
  let requestHandler;
  const server = {
    address: () => ({ port: 49152 }),
    close: (complete) => {
      server.listening = false;
      complete();
    },
    closeAllConnections: () => {},
    listen: (_options, ready) => {
      server.listening = true;
      ready();
    },
    listening: false,
    once: () => {},
  };
  const recorder = await createLoopbackRecorder({
    createServer: (handler) => {
      requestHandler = handler;
      return server;
    },
  });
  requestHandler(
    {
      headers: {
        "x-amz-security-token": "opaque-amz-value",
        "x-goog-api-key": "opaque-google-value",
        "x-local-studio-token": "opaque-studio-value",
      },
      resume: () => {},
      url: "/v1/status",
    },
    { end: () => {}, writeHead: () => {} },
  );
  assert.deepEqual(recorder.snapshot(), {
    credentialSignals: ["x-amz-security-token", "x-goog-api-key", "x-local-studio-token"],
    requestCount: 1,
  });
  assert.equal(JSON.stringify(recorder.snapshot()).includes("opaque"), false);
  await recorder.close();
});

test("fails closed on any sentinel contact or controller credential signal", async () => {
  const context = {
    controllerSink: {
      close: async () => {},
      snapshot: () => ({ credentialSignals: ["authorization"], requestCount: 1 }),
    },
    productionSentinel: {
      close: async () => {},
      snapshot: () => ({ credentialSignals: [], requestCount: 1 }),
    },
    root: "/tmp/smoke",
  };
  await assert.rejects(
    cleanupSmoke({ context }, { remove: async () => {} }),
    /Production controller sentinel received 1 request.*Isolated controller sink received credential signals: authorization/,
  );
});

test("removes partial isolated state when preparation fails after mkdtemp", async () => {
  const calls = [];
  await assert.rejects(
    prepareSmokeContext("/app", {
      makeDirectory: async (directory) => {
        calls.push(`mkdir:${directory}`);
        throw new Error("mkdir failed");
      },
      makeTemporaryDirectory: async () => "/tmp/partial-smoke",
      remove: async (directory) => calls.push(`remove:${directory}`),
    }),
    /mkdir failed/,
  );
  assert.equal(calls.at(-1), "remove:/tmp/partial-smoke");
});

test("prepares both isolated recorders and cleans the first if the second fails", async () => {
  const calls = [];
  const controllerSink = {
    close: async () => calls.push("close:sink"),
    snapshot: () => ({ credentialSignals: [], requestCount: 0 }),
    url: smokeControllerUrl,
  };
  await assert.rejects(
    prepareSmokeContext("/app", {
      createRecorder: async (options) => {
        calls.push(`recorder:${options.responseStatus}:${options.port ?? "random"}`);
        if (options.responseStatus === 421) throw new Error("sentinel failed");
        return controllerSink;
      },
      makeDirectory: async (directory) => calls.push(`mkdir:${directory}`),
      makeTemporaryDirectory: async () => "/tmp/prepared-smoke",
      remove: async (directory) => calls.push(`remove:${directory}`),
    }),
    /sentinel failed/,
  );
  assert.ok(calls.includes("recorder:503:65534"));
  assert.ok(calls.includes("recorder:421:random"));
  assert.ok(calls.indexOf("close:sink") < calls.indexOf("remove:/tmp/prepared-smoke"));
  assert.equal(calls.at(-1), "remove:/tmp/prepared-smoke");
});

test("releases a temporary root that resolves after its acquisition deadline", async () => {
  const removed = [];
  let resolveRoot;
  const deadline = createLifecycleDeadline(25_020);
  const preparing = prepareSmokeContext("/app", {
    deadline,
    makeTemporaryDirectory: () => new Promise((resolve) => (resolveRoot = resolve)),
    remove: async (path) => removed.push(path),
    removeImmediately: (path) => removed.push(path),
  });
  await assert.rejects(preparing, /Smoke temporary directory timed out/);
  resolveRoot("/tmp/late-smoke-root");
  await new Promise((resolve) => setImmediate(resolve));
  deadline.dispose();
  assert.deepEqual(removed, ["/tmp/late-smoke-root"]);
});

test("releases a recorder that resolves after its acquisition deadline", async () => {
  const closed = [];
  let resolveRecorder;
  const deadline = createLifecycleDeadline(25_020);
  const preparing = prepareSmokeContext("/app", {
    createRecorder: () => new Promise((resolve) => (resolveRecorder = resolve)),
    deadline,
    makeDirectory: async () => {},
    makeTemporaryDirectory: async () => "/tmp/late-recorder-root",
    remove: async () => {},
  });
  await assert.rejects(preparing, /Smoke controller sink timed out/);
  resolveRecorder({
    close: async () => closed.push("late recorder"),
    emergencyClose: () => closed.push("late recorder"),
  });
  await new Promise((resolve) => setImmediate(resolve));
  deadline.dispose();
  assert.deepEqual(closed, ["late recorder"]);
});

test("detects early app exit while waiting for the port file", async () => {
  await assert.rejects(
    waitForEmbeddedPort({
      childStatus: () => ({ code: 7, signal: null }),
      portFile: "/tmp/embedded-frontend.port",
      readFile: async () => {
        throw missingFile();
      },
      timeoutMs: 100,
      ...fakeClock(),
    }),
    /exited before embedded frontend port.*code 7/,
  );
});

test("bounds missing and malformed port-file failures", async () => {
  await assert.rejects(
    waitForEmbeddedPort({
      childStatus: () => null,
      portFile: "/tmp/embedded-frontend.port",
      readFile: async () => {
        throw missingFile();
      },
      timeoutMs: 100,
      ...fakeClock(),
    }),
    /port file timed out after 100ms/,
  );
  await assert.rejects(
    waitForEmbeddedPort({
      childStatus: () => null,
      portFile: "/tmp/embedded-frontend.port",
      readFile: async () => "not-a-port",
      timeoutMs: 100,
      ...fakeClock(),
    }),
    /Malformed embedded frontend port/,
  );
});

test("rejects non-200, invalid, and unhealthy health responses", async () => {
  const response = (status, json) => async () => ({ json, status });
  await assert.rejects(
    waitForDesktopHealth({
      childStatus: () => null,
      fetchResponse: response(502, async () => ({ ok: true, ts: 42 })),
      timeoutMs: 100,
      url: "http://127.0.0.1:4000/api/desktop-health",
      ...fakeClock(),
    }),
    /status 502/,
  );
  await assert.rejects(
    waitForDesktopHealth({
      childStatus: () => null,
      fetchResponse: response(200, async () => {
        throw new SyntaxError("invalid JSON");
      }),
      timeoutMs: 100,
      url: "http://127.0.0.1:4000/api/desktop-health",
      ...fakeClock(),
    }),
    /invalid JSON/,
  );
  await assert.rejects(
    waitForDesktopHealth({
      childStatus: () => null,
      fetchResponse: response(200, async () => ({ ok: false, ts: 42 })),
      timeoutMs: 100,
      url: "http://127.0.0.1:4000/api/desktop-health",
      ...fakeClock(),
    }),
    /unhealthy JSON/,
  );
});

test("bounds health and CDP target discovery timeouts", async () => {
  await assert.rejects(
    waitForDesktopHealth({
      childStatus: () => null,
      fetchResponse: async () => {
        throw new Error("connection refused");
      },
      timeoutMs: 100,
      url: "http://127.0.0.1:4000/api/desktop-health",
      ...fakeClock(),
    }),
    /desktop health timed out after 100ms.*connection refused/,
  );
  await assert.rejects(
    waitForPageTarget({
      childStatus: () => null,
      fetchTargets: async () => [],
      origin: "http://127.0.0.1:4000",
      timeoutMs: 100,
      ...fakeClock(),
    }),
    /CDP page target timed out after 100ms/,
  );
});

test("selects only the BrowserWindow target for the embedded origin", async () => {
  assert.deepEqual(
    await waitForPageTarget({
      cdpPort: 9222,
      childStatus: () => null,
      fetchTargets: async () => [
        {
          type: "page",
          url: "https://example.com/",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/wrong",
        },
        {
          type: "page",
          url: "http://127.0.0.1:4000/agent",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/right",
        },
      ],
      origin: "http://127.0.0.1:4000",
      timeoutMs: 100,
      ...fakeClock(),
    }),
    {
      type: "page",
      url: "http://127.0.0.1:4000/agent",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/right",
    },
  );
});

test("always cleans up every launched lifecycle failure", async () => {
  for (const failingStage of ["launch", "waitForPort", "verifyHealth", "verifyBridge"]) {
    const calls = [];
    const operation = (name, value) => async () => {
      calls.push(name);
      if (name === failingStage) throw new Error(`${name} failed`);
      return value;
    };
    await assert.rejects(
      executeSmokeLifecycle({
        cleanup: operation("cleanup"),
        launch: operation("launch", { pid: 100 }),
        prepare: operation("prepare", { root: "/tmp/smoke" }),
        verifyBridge: operation("verifyBridge", { available: true }),
        verifyHealth: operation("verifyHealth", { ok: true }),
        waitForPort: operation("waitForPort", 4000),
      }),
      new RegExp(`${failingStage} failed`),
    );
    assert.equal(calls.at(-1), "cleanup");
    assert.equal(calls.filter((name) => name === "cleanup").length, 1);
  }
});

test("reports both the primary and cleanup failure", async () => {
  await assert.rejects(
    executeSmokeLifecycle({
      cleanup: async () => {
        throw new Error("cleanup failed");
      },
      launch: async () => ({ pid: 100 }),
      prepare: async () => ({ root: "/tmp/smoke" }),
      verifyBridge: async () => ({ available: true }),
      verifyHealth: async () => ({ ok: true }),
      waitForPort: async () => {
        throw new Error("port failed");
      },
    }),
    /port failed; cleanup failed: cleanup failed/,
  );
});

test("uses one absolute lifecycle deadline and still runs cleanup", async () => {
  const calls = [];
  const startedAt = Date.now();
  let pendingTimer;
  await assert.rejects(
    executeSmokeLifecycle(
      {
        cleanup: async () => calls.push("cleanup"),
        launch: async ({ deadline }) =>
          new Promise((resolve, reject) => {
            pendingTimer = setTimeout(resolve, 1_000);
            deadline.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(pendingTimer);
                pendingTimer = undefined;
                calls.push("abort");
                reject(deadline.signal.reason);
              },
              { once: true },
            );
          }),
        prepare: async () => ({ root: "/tmp/smoke" }),
        verifyBridge: async () => ({ available: true }),
        verifyHealth: async () => ({ ok: true }),
        waitForPort: async () => 4000,
      },
      {
        cleanupReserveMs: 20,
        deadline: createLifecycleDeadline(40),
      },
    ),
    /lifecycle timed out after \d+ms/,
  );
  assert.deepEqual(calls, ["abort", "cleanup"]);
  assert.equal(pendingTimer, undefined);
  assert.ok(Date.now() - startedAt < 200);
});

test("tracks Browser.close through response, remote-close, and bounded no-response outcomes", async () => {
  const activeTimers = new Set();
  const setTimer = (handler, duration) => {
    const timer = setTimeout(() => {
      activeTimers.delete(timer);
      handler();
    }, duration);
    activeTimers.add(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    activeTimers.delete(timer);
    clearTimeout(timer);
  };
  class FakeWebSocket {
    constructor() {
      FakeWebSocket.instance = this;
      this.listeners = new Map();
      this.readyState = 0;
      this.sent = [];
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit("open", {});
      });
    }

    addEventListener(name, listener) {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    }

    close() {
      this.readyState = 2;
      setTimeout(() => {
        this.readyState = 3;
        this.emit("close", {});
      }, 10);
    }

    emit(name, event) {
      for (const listener of this.listeners.get(name) ?? []) listener(event);
    }

    send(value) {
      this.sent.push(JSON.parse(value));
    }
  }

  const session = await createCdpSession("ws://127.0.0.1:9222/page", {
    WebSocketClass: FakeWebSocket,
    clearTimer,
    setTimer,
    timeoutMs: 1_000,
  });
  const closing = session.requestClose();
  assert.deepEqual(FakeWebSocket.instance.sent[0], {
    id: 1,
    method: "Browser.close",
    params: {},
  });
  FakeWebSocket.instance.emit("message", {
    data: JSON.stringify({ id: 1, result: {} }),
  });
  assert.equal(await closing, "response");
  await session.close();

  const closeFirstSession = await createCdpSession("ws://127.0.0.1:9222/page", {
    WebSocketClass: FakeWebSocket,
    clearTimer,
    setTimer,
    timeoutMs: 1_000,
  });
  const closeWithoutResponse = closeFirstSession.requestClose();
  FakeWebSocket.instance.close();
  assert.equal(await closeWithoutResponse, "close");

  const noResponseSession = await createCdpSession("ws://127.0.0.1:9222/page", {
    WebSocketClass: FakeWebSocket,
    clearTimer,
    setTimer,
    timeoutMs: 20,
  });
  assert.equal(await noResponseSession.requestClose(), "timeout");
  await noResponseSession.close();
  assert.equal(activeTimers.size, 0);
});

test("surfaces a tracked Browser.close CDP error", async () => {
  class FakeWebSocket {
    constructor() {
      FakeWebSocket.instance = this;
      this.listeners = new Map();
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit("open", {});
      });
    }

    addEventListener(name, listener) {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    }

    close() {
      this.readyState = 3;
      this.emit("close", {});
    }

    emit(name, event) {
      for (const listener of this.listeners.get(name) ?? []) listener(event);
    }

    send(value) {
      const request = JSON.parse(value);
      queueMicrotask(() =>
        this.emit("message", {
          data: JSON.stringify({ error: { message: "close denied" }, id: request.id }),
        }),
      );
    }
  }

  const session = await createCdpSession("ws://127.0.0.1:9222/page", {
    WebSocketClass: FakeWebSocket,
    timeoutMs: 100,
  });
  await assert.rejects(session.requestClose(), /CDP command failed.*close denied/);
  await session.close();
});

test("hard deadline bounds a never-settling cleanup and invokes emergency cleanup", async () => {
  const context = { root: "/tmp/smoke" };
  const launched = { pid: 100 };
  const emergencies = [];
  const startedAt = Date.now();
  let guard;
  try {
    await assert.rejects(
      Promise.race([
        executeSmokeLifecycle(
          {
            cleanup: async () => new Promise(() => {}),
            emergencyCleanup: (state) => emergencies.push(state),
            launch: async () => launched,
            prepare: async () => context,
            verifyBridge: async () => ({ available: true }),
            verifyHealth: async () => ({ ok: true }),
            waitForPort: async () => 4000,
          },
          { deadline: createLifecycleDeadline(40) },
        ),
        new Promise((_, reject) => {
          guard = setTimeout(() => reject(new Error("external regression guard expired")), 200);
        }),
      ]),
      /Packaged desktop smoke cleanup timed out after \d+ms/,
    );
  } finally {
    clearTimeout(guard);
  }
  assert.equal(emergencies.length, 1);
  assert.equal(emergencies[0].context, context);
  assert.equal(emergencies[0].launched, launched);
  assert.ok(Date.now() - startedAt < 150);
});

test("hard deadline bounds never-settling acquisition and cleanup together", async () => {
  const emergencies = [];
  const startedAt = Date.now();
  let guard;
  try {
    await assert.rejects(
      Promise.race([
        executeSmokeLifecycle(
          {
            cleanup: async () => new Promise(() => {}),
            emergencyCleanup: (state) => emergencies.push(state),
            launch: async () => ({ pid: 100 }),
            prepare: async () => new Promise(() => {}),
            verifyBridge: async () => ({ available: true }),
            verifyHealth: async () => ({ ok: true }),
            waitForPort: async () => 4000,
          },
          { cleanupReserveMs: 20, deadline: createLifecycleDeadline(40) },
        ),
        new Promise((_, reject) => {
          guard = setTimeout(() => reject(new Error("external regression guard expired")), 200);
        }),
      ]),
      /lifecycle timed out.*cleanup failed.*cleanup timed out/su,
    );
  } finally {
    clearTimeout(guard);
  }
  assert.equal(emergencies.length, 1);
  assert.ok(Date.now() - startedAt < 150);
});

test("emergency-cleans lifecycle state that resolves after its phase deadline", async () => {
  const context = { root: "/tmp/smoke" };
  const launched = { pid: 100 };
  const emergencies = [];
  let resolveLaunch;
  await assert.rejects(
    executeSmokeLifecycle(
      {
        cleanup: async () => {},
        emergencyCleanup: (state) => emergencies.push(state),
        launch: async () => new Promise((resolve) => (resolveLaunch = resolve)),
        prepare: async () => context,
        verifyBridge: async () => ({ available: true }),
        verifyHealth: async () => ({ ok: true }),
        waitForPort: async () => 4000,
      },
      {
        cleanupReserveMs: 20,
        deadline: createLifecycleDeadline(40),
      },
    ),
    /Packaged desktop smoke lifecycle timed out after \d+ms/,
  );
  resolveLaunch(launched);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(emergencies.some((state) => state.context === context && state.launched === launched));
});

test("emergency cleanup kills the process tree, closes recorders, and removes temp state", () => {
  const calls = [];
  emergencyCleanupSmoke(
    {
      context: {
        controllerSink: { emergencyClose: () => calls.push("controller") },
        productionSentinel: { emergencyClose: () => calls.push("sentinel") },
        root: "/tmp/smoke",
      },
      launched: { embeddedPids: new Set([101, 102]) },
    },
    {
      isPidAlive: (pid) => pid === 101,
      isTreeAlive: () => true,
      kill: (pid, signal) => calls.push(`${pid}:${signal}`),
      remove: (path) => calls.push(path),
      signal: (_launched, signal) => calls.push(signal),
    },
  );
  assert.deepEqual(calls, [
    "SIGKILL",
    "101:SIGKILL",
    "sentinel",
    "controller",
    "/tmp/smoke",
  ]);
});

test("escalates bounded cleanup and removes isolated state", async () => {
  const calls = [];
  const waits = [false, false, true];
  await cleanupSmoke(
    {
      context: { root: "/tmp/smoke" },
      launched: { embeddedPids: new Set([101]) },
    },
    {
      isPidAlive: () => false,
      isTreeAlive: () => true,
      recordPid: async () => calls.push("record"),
      remove: async () => calls.push("remove"),
      requestQuit: async () => calls.push("quit"),
      signal: (_launched, signal) => calls.push(signal),
      waitForExit: async (_launched, timeoutMs) => {
        calls.push(timeoutMs);
        return waits.shift();
      },
    },
  );
  assert.deepEqual(calls, ["record", "quit", 10_000, "SIGTERM", 5_000, "SIGKILL", 5_000, "remove"]);
});

test("surfaces graceful-quit errors after retaining forced cleanup fallback", async () => {
  const calls = [];
  let alive = true;
  await assert.rejects(
    cleanupSmoke(
      {
        context: { root: "/tmp/smoke" },
        launched: { embeddedPids: new Set() },
      },
      {
        isPidAlive: () => false,
        isTreeAlive: () => alive,
        recordPid: async () => calls.push("record"),
        remove: async () => calls.push("remove"),
        requestQuit: async () => {
          calls.push("quit");
          throw new Error("Browser.close rejected");
        },
        signal: (_launched, signal) => {
          calls.push(signal);
          alive = false;
        },
        waitForExit: async () => {
          calls.push("wait");
          return false;
        },
      },
    ),
    /Browser\.close rejected/,
  );
  assert.deepEqual(calls, ["record", "quit", "wait", "SIGTERM", "remove"]);
});

test("proves graceful quit through process-tree exit without forced signals", async () => {
  const calls = [];
  await cleanupSmoke(
    {
      context: { root: "/tmp/smoke" },
      launched: { embeddedPids: new Set() },
    },
    {
      isPidAlive: () => false,
      isTreeAlive: () => false,
      recordPid: async () => calls.push("record"),
      remove: async () => calls.push("remove"),
      requestQuit: async () => calls.push("quit"),
      signal: (_launched, signal) => calls.push(signal),
      waitForExit: async () => {
        calls.push("exit");
        return true;
      },
    },
  );
  assert.deepEqual(calls, ["record", "quit", "exit", "remove"]);
});

test("removes isolated state even when leftover verification fails", async () => {
  const calls = [];
  await assert.rejects(
    cleanupSmoke(
      {
        context: { root: "/tmp/smoke" },
        launched: { embeddedPids: new Set([101]) },
      },
      {
        isPidAlive: () => true,
        isTreeAlive: () => false,
        kill: () => {},
        recordPid: async () => {},
        remove: async () => calls.push("remove"),
        requestQuit: async () => {},
        waitForExit: async () => true,
      },
    ),
    /Embedded frontend process 101 remained/,
  );
  assert.deepEqual(calls, ["remove"]);
});

test("returns a successful lifecycle result after cleanup", async () => {
  const calls = [];
  const operation = (name, value) => async () => {
    calls.push(name);
    return value;
  };
  assert.deepEqual(
    await executeSmokeLifecycle({
      cleanup: operation("cleanup"),
      launch: operation("launch", { pid: 100 }),
      prepare: operation("prepare", { root: "/tmp/smoke" }),
      verifyBridge: operation("verifyBridge", { available: true }),
      verifyHealth: operation("verifyHealth", { ok: true, ts: 42 }),
      waitForPort: operation("waitForPort", 4000),
    }),
    {
      bridge: { available: true },
      health: { ok: true, ts: 42 },
      port: 4000,
    },
  );
  assert.deepEqual(calls, [
    "prepare",
    "launch",
    "waitForPort",
    "verifyHealth",
    "verifyBridge",
    "cleanup",
  ]);
});
