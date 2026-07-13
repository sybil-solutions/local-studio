import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactLogLine } from "../../src/core/log-redaction";
import { primaryLogPathFor } from "../../src/core/log-files";

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
  "PI_CODING_AGENT_DIR",
] as const;

let envSnapshot: Record<string, string | undefined>;
let tempDir: string;

beforeEach(() => {
  envSnapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  tempDir = mkdtempSync(join(tmpdir(), "local-studio-log-redaction-"));
  Object.assign(process.env, {
    LOCAL_STUDIO_DATA_DIR: tempDir,
    LOCAL_STUDIO_DB_PATH: join(tempDir, "controller.db"),
    LOCAL_STUDIO_MODELS_DIR: join(tempDir, "models"),
    LOCAL_STUDIO_HOST: "127.0.0.1",
    LOCAL_STUDIO_PORT: "18080",
    LOCAL_STUDIO_INFERENCE_PORT: "65534",
    LOCAL_STUDIO_MOCK_INFERENCE: "true",
    LOCAL_STUDIO_MOCK_MODEL_ID: "mock-model",
    PI_CODING_AGENT_DIR: join(tempDir, "pi-agent"),
  });
  delete process.env.LOCAL_STUDIO_API_KEY;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("redactLogLine", () => {
  test("redacts Authorization Bearer tokens", () => {
    expect(redactLogLine("Authorization: Bearer sk-abc123xyz")).toBe(
      "Authorization: Bearer [redacted]",
    );
    expect(redactLogLine("authorization: bearer eyJhbGciOiJIUzI1NiJ9")).toBe(
      "authorization: bearer [redacted]",
    );
  });

  test("redacts X-Api-Key headers", () => {
    expect(redactLogLine("X-Api-Key: sk-test-key")).toBe("X-Api-Key: [redacted]");
    expect(redactLogLine("x-api-key: hf_secret_value")).toBe("x-api-key: [redacted]");
  });

  test("redacts HF token env assignments", () => {
    expect(redactLogLine("HF_TOKEN=hf_abcdef123456")).toBe("HF_TOKEN=[redacted]");
    expect(redactLogLine("HUGGING_FACE_HUB_TOKEN=hf_secret")).toBe(
      "HUGGING_FACE_HUB_TOKEN=[redacted]",
    );
    expect(redactLogLine('export HF_TOKEN="hf_quoted_token"')).toBe("export HF_TOKEN=[redacted]");
  });

  test("redacts OpenAI / Anthropic API key env assignments", () => {
    expect(redactLogLine("OPENAI_API_KEY=sk-openai-secret")).toBe("OPENAI_API_KEY=[redacted]");
    expect(redactLogLine("ANTHROPIC_API_KEY=sk-ant-secret")).toBe("ANTHROPIC_API_KEY=[redacted]");
  });

  test("redacts generic *_API_KEY and *_TOKEN env assignments", () => {
    expect(redactLogLine("MY_SERVICE_API_KEY=abc123")).toBe("MY_SERVICE_API_KEY=[redacted]");
    expect(redactLogLine("SESSION_TOKEN=xyz789")).toBe("SESSION_TOKEN=[redacted]");
  });

  test("redacts JSON-ish secret pairs", () => {
    expect(redactLogLine('{ "api_key": "sk-json-key" }')).toBe('{ "api_key": "[redacted]" }');
    expect(redactLogLine("{ 'token': 'secret-token' }")).toBe("{ 'token': '[redacted]' }");
    expect(redactLogLine('{"openai_api_key":"sk-123"}')).toBe('{"openai_api_key":"[redacted]"}');
  });

  test("redacts CLI flag secrets", () => {
    expect(redactLogLine("vllm serve --api-key sk-api-key-value")).toBe(
      "vllm serve --api-key [redacted]",
    );
    expect(redactLogLine("python -m vllm --hf-token hf_secret")).toBe(
      "python -m vllm --hf-token [redacted]",
    );
    expect(redactLogLine("cmd --token secret")).toBe("cmd --token [redacted]");
  });

  test("redacts URL query parameter secrets", () => {
    expect(redactLogLine("https://api.example.com/v1?api_key=sk-123&model=gpt4")).toBe(
      "https://api.example.com/v1?api_key=[redacted]&model=gpt4",
    );
    expect(redactLogLine("http://host/path?token=secret&other=value")).toBe(
      "http://host/path?token=[redacted]&other=value",
    );
  });

  test("preserves ordinary log context", () => {
    const errorLine =
      "RuntimeError: CUDA out of memory. Tried to allocate 3.45 GiB. GPU 0 has 5.00 GiB total";
    expect(redactLogLine(errorLine)).toBe(errorLine);
  });

  test("preserves throughput metrics", () => {
    const metric = "llama-server: tokens per second = 42.5";
    expect(redactLogLine(metric)).toBe(metric);
  });

  test("preserves file paths without secret markers", () => {
    const path = "Loading model from /home/user/models/Llama-3.1-8B-Instruct-Q4_K_M.gguf";
    expect(redactLogLine(path)).toBe(path);
  });

  test("redacts secrets in a multi-token line while keeping context", () => {
    const line =
      "request failed Authorization: Bearer sk-leaked; retry with OPENAI_API_KEY=sk-other";
    expect(redactLogLine(line)).toBe(
      "request failed Authorization: Bearer [redacted]; retry with OPENAI_API_KEY=[redacted]",
    );
  });
});

describe("per-line redaction of multi-line content", () => {
  test("redacts secrets across multiple lines", () => {
    const content = "line1\nAuthorization: Bearer sk-abc\nline3\nHF_TOKEN=hf_123\n";
    const redacted = content.split("\n").map(redactLogLine).join("\n");
    expect(redacted).toBe("line1\nAuthorization: Bearer [redacted]\nline3\nHF_TOKEN=[redacted]\n");
  });
});

describe("GET /logs/:sessionId redaction", () => {
  test("returns redacted log lines without rewriting the file", async () => {
    const recipeId = "test-recipe";
    const logPath = primaryLogPathFor(tempDir, recipeId);
    writeFileSync(
      logPath,
      [
        "Starting model load",
        "Authorization: Bearer sk-live-token",
        "OPENAI_API_KEY=sk-openai-key",
        "CUDA out of memory",
      ].join("\n"),
      "utf8",
    );

    const [{ createAppContext }, { createApp }] = await Promise.all([
      import("../../src/app-context"),
      import("../../src/http/app"),
    ]);
    const context = createAppContext();
    const app = createApp(context);

    const response = await app.request(`/logs/${recipeId}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.logs).toEqual([
      "Starting model load",
      "Authorization: Bearer [redacted]",
      "OPENAI_API_KEY=[redacted]",
      "CUDA out of memory",
    ]);
    expect(body.content).toBe(body.logs.join("\n"));

    // Raw file on disk is unchanged.
    const raw = await Bun.file(logPath).text();
    expect(raw).toContain("sk-live-token");
    expect(raw).toContain("sk-openai-key");
  });
});
