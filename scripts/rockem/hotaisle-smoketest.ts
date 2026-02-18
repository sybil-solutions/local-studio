// CRITICAL
type SmokeOptions = {
  baseUrl: string;
  expectRocm: boolean;
  timeoutMs: number;
};

type CheckResult = {
  name: string;
  ok: boolean;
  details: string;
};

const usage = (): void => {
  console.log(`Usage: bun scripts/rockem/hotaisle-smoketest.ts [options]

Options:
  --base-url <url>      Controller URL (default: http://127.0.0.1:8080)
  --expect-rocm         Fail if runtime platform is not rocm
  --timeout-ms <ms>     Request timeout in milliseconds (default: 10000)
  --help                Show this help
`);
};

const parseOptions = (): SmokeOptions => {
  const options: SmokeOptions = {
    baseUrl: process.env["ROCKEM_CONTROLLER_URL"] ?? "http://127.0.0.1:8080",
    expectRocm: false,
    timeoutMs: 10_000,
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--expect-rocm") {
      options.expectRocm = true;
      continue;
    }
    const next = args[index + 1];
    if (!next) {
      throw new Error(`Missing value for ${arg}`);
    }
    if (arg === "--base-url") {
      options.baseUrl = next.replace(/\/$/, "");
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("timeout-ms must be a positive number");
  }

  return options;
};

const fetchJson = async (
  baseUrl: string,
  path: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<{ status: number; json: unknown; text: string }> => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json, text };
};

const run = async (): Promise<void> => {
  const options = parseOptions();
  const checks: CheckResult[] = [];
  console.log(`Running smoke tests against ${options.baseUrl}`);

  const health = await fetchJson(options.baseUrl, "/health", options.timeoutMs);
  checks.push({
    name: "GET /health",
    ok: health.status === 200 && Boolean((health.json as Record<string, unknown>)?.["status"]),
    details: `status=${health.status}`,
  });

  const config = await fetchJson(options.baseUrl, "/config", options.timeoutMs);
  const runtime = ((config.json as Record<string, unknown>)?.["runtime"] ?? {}) as Record<string, unknown>;
  const platform = (runtime["platform"] ?? {}) as Record<string, unknown>;
  const kind = typeof platform["kind"] === "string" ? platform["kind"] : "unknown";
  checks.push({
    name: "GET /config runtime payload",
    ok: config.status === 200 && (kind === "cuda" || kind === "rocm" || kind === "unknown"),
    details: `status=${config.status} platform.kind=${kind}`,
  });
  if (options.expectRocm) {
    checks.push({
      name: "platform is ROCm",
      ok: kind === "rocm",
      details: `platform.kind=${kind}`,
    });
  }

  const compat = await fetchJson(options.baseUrl, "/compat", options.timeoutMs);
  const compatObj = (compat.json ?? {}) as Record<string, unknown>;
  checks.push({
    name: "GET /compat checks payload",
    ok: compat.status === 200 && Array.isArray(compatObj["checks"]),
    details: `status=${compat.status}`,
  });

  const gpus = await fetchJson(options.baseUrl, "/gpus", options.timeoutMs);
  checks.push({
    name: "GET /gpus array response",
    ok:
      gpus.status === 200 &&
      Array.isArray((gpus.json as Record<string, unknown> | null)?.["gpus"] ?? []),
    details: `status=${gpus.status}`,
  });

  const services = await fetchJson(options.baseUrl, "/services", options.timeoutMs);
  checks.push({
    name: "GET /services array response",
    ok:
      services.status === 200 &&
      Array.isArray((services.json as Record<string, unknown> | null)?.["services"] ?? []),
    details: `status=${services.status}`,
  });

  const jobs = await fetchJson(options.baseUrl, "/jobs", options.timeoutMs);
  checks.push({
    name: "GET /jobs array response",
    ok: jobs.status === 200 && Array.isArray((jobs.json as Record<string, unknown> | null)?.["jobs"] ?? []),
    details: `status=${jobs.status}`,
  });

  const emptyForm = new FormData();
  const stt = await fetchJson(options.baseUrl, "/v1/audio/transcriptions", options.timeoutMs, {
    method: "POST",
    body: emptyForm,
  });
  checks.push({
    name: "POST /v1/audio/transcriptions route active",
    ok: stt.status !== 404 && stt.status < 500,
    details: `status=${stt.status}`,
  });

  const tts = await fetchJson(options.baseUrl, "/v1/audio/speech", options.timeoutMs, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  checks.push({
    name: "POST /v1/audio/speech route active",
    ok: tts.status !== 404 && tts.status < 500,
    details: `status=${tts.status}`,
  });

  const failing = checks.filter((check) => !check.ok);
  for (const check of checks) {
    const icon = check.ok ? "PASS" : "FAIL";
    console.log(`${icon} ${check.name} (${check.details})`);
  }

  if (failing.length > 0) {
    console.error(`\nSmoke test failed: ${failing.length} check(s) failed.`);
    process.exit(1);
  }

  console.log("\nSmoke test passed.");
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
