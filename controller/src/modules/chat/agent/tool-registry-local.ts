// CRITICAL
import { exec } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdirSync } from "node:fs";
import { isIP } from "node:net";
import { resolve, sep } from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import type { AppContext } from "../../../types/context";
import { AGENT_TOOL_NAMES } from "./contracts";
import { createTextResult } from "./tool-registry-common";

const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 180;
const MAX_OUTPUT_CHARS = 16_000;
const LOCAL_TOOL_ROOT_DIR = "agent-tools-shell";
const SAFE_ENV_KEYS = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "SHELL", "USER", "LOGNAME"] as const;
const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost"] as const;
const BLOCKED_COMMAND_PATTERNS = [
  /(^|\s)sudo(\s|$)/i,
  /(^|\s)rm\s+-rf\s+\/(\s|$)/i,
  /(^|\s)(shutdown|reboot)(\s|$)/i,
  /(^|\s)mkfs(\.|\/|\s|$)/i,
] as const;

interface LocalToolOptions {
  sessionId: string;
}

const sanitizeSessionId = (sessionId: string): string => {
  const cleaned = sessionId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return cleaned.length > 0 ? cleaned : "session";
};

const clampTimeoutSeconds = (value: number | undefined, fallback: number): number => {
  const timeout = Number.isFinite(value) && typeof value === "number" ? value : fallback;
  return Math.max(1, Math.min(MAX_TIMEOUT_SECONDS, Math.ceil(timeout)));
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Fall through to command string fallback.
      }
    }
    return { command: trimmed };
  }
  return {};
};

const readStringArgument = (params: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = params[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
};

const readPositiveNumberArgument = (
  params: Record<string, unknown>,
  keys: string[]
): number | undefined => {
  for (const key of keys) {
    const value = params[key];
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number.parseFloat(value.trim())
          : Number.NaN;
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return undefined;
};

const COMMAND_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    command: { type: "string" },
    cmd: { type: "string" },
    cwd: { type: "string" },
    workdir: { type: "string" },
    timeout: { type: "number" },
    timeout_ms: { type: "number" },
  },
  anyOf: [{ required: ["command"] }, { required: ["cmd"] }],
} as unknown as TSchema;

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\"'\"'`)}'`;

const truncateText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated]`;
};

const parseCommandPayload = (
  raw: Record<string, unknown>
): { command: string; cwd?: string; timeout?: number } => {
  const command = readStringArgument(raw, ["command", "cmd", "shell_command", "shellCommand"]) ?? "";
  if (!command) {
    throw new Error("command (or cmd) is required");
  }

  const cwd = readStringArgument(raw, [
    "cwd",
    "workdir",
    "working_directory",
    "workingDirectory",
    "directory",
  ]);
  const timeoutSeconds = readPositiveNumberArgument(raw, ["timeout", "timeout_seconds", "timeoutSeconds"]);
  const timeoutMs = readPositiveNumberArgument(raw, ["timeout_ms", "timeoutMs"]);
  const timeout =
    timeoutSeconds ?? (timeoutMs !== undefined ? Math.max(1, Math.ceil(timeoutMs / 1000)) : undefined);

  return {
    command,
    ...(cwd ? { cwd } : {}),
    ...(typeof timeout === "number" && Number.isFinite(timeout) ? { timeout } : {}),
  };
};

const buildSafeEnvironment = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { TERM: "dumb" };
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }
  return env;
};

const ensureSessionRoot = (context: AppContext, sessionId: string): string => {
  const root = resolve(context.config.data_dir, LOCAL_TOOL_ROOT_DIR, sanitizeSessionId(sessionId));
  mkdirSync(root, { recursive: true });
  return root;
};

const isPathInsideRoot = (root: string, candidate: string): boolean => {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot);
};

const resolveSandboxedCwd = (sessionRoot: string, cwd?: string): string => {
  const raw = (cwd ?? "").trim();
  if (!raw) {
    return sessionRoot;
  }

  const resolved = raw.startsWith("/") ? resolve(raw) : resolve(sessionRoot, raw);
  if (!isPathInsideRoot(sessionRoot, resolved)) {
    throw new Error(`cwd escapes sandbox root: ${raw}`);
  }
  return resolved;
};

const ensureCommandAllowed = (command: string): void => {
  if (command.length > 32000) {
    throw new Error("command is too large");
  }
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error("command contains a blocked operation");
    }
  }
};

const isBlockedIPv4 = (address: string): boolean => {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  if (a === undefined || b === undefined) {
    return true;
  }

  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
};

const isBlockedIPv6 = (address: string): boolean => {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) === 4 ? isBlockedIPv4(mapped) : true;
  }
  if (/^f[c-d]/.test(normalized)) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  return false;
};

const isBlockedIpAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return isBlockedIPv4(address);
  if (family === 6) return isBlockedIPv6(address);
  return true;
};

const validateBrowserUrl = async (value: string): Promise<string> => {
  const raw = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("only http/https URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  if (!hostname) {
    throw new Error("invalid URL host");
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("localhost URLs are not allowed");
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error("private/internal hostnames are not allowed");
  }

  if (isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw new Error("private or non-routable IP addresses are not allowed");
    }
    return parsed.toString();
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = (await lookup(hostname, {
      all: true,
      verbatim: true,
    })) as Array<{ address: string; family: number }>;
  } catch {
    throw new Error(`unable to resolve host: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new Error(`unable to resolve host: ${hostname}`);
  }
  for (const entry of addresses) {
    if (isBlockedIpAddress(entry.address)) {
      throw new Error("URL resolves to a private or non-routable IP address");
    }
  }

  return parsed.toString();
};

/**
 * Execute a shell command locally and return stdout/stderr and exit code.
 */
const executeLocal = (
  command: string,
  options: { cwd: string; timeoutSeconds: number }
): Promise<{ result: string; exitCode: number; signal: string | null }> => {
  const timeoutMs = options.timeoutSeconds * 1000;

  return new Promise((resolveExecution) => {
    exec(
      command,
      {
        shell: "/bin/bash",
        cwd: options.cwd,
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: buildSafeEnvironment(),
      },
      (error, stdout, stderr) => {
        const combined = `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim();
        const errorCode = (error as NodeJS.ErrnoException & { code?: unknown })?.code;
        const signal = typeof (error as NodeJS.ErrnoException & { signal?: unknown })?.signal === "string"
          ? String((error as NodeJS.ErrnoException & { signal?: unknown })?.signal)
          : null;
        const exitCode = typeof errorCode === "number" ? errorCode : error ? 1 : 0;

        resolveExecution({
          result: combined || "(no output)",
          exitCode,
          signal,
        });
      }
    );
  });
};

const buildBrowserProbeCommand = (url: string): string =>
  [
    "set -euo pipefail",
    "if ! command -v curl >/dev/null 2>&1; then echo 'curl is required'; exit 127; fi",
    `URL=${shellQuote(url)}`,
    "tmp=$(mktemp)",
    "cleanup(){ rm -f \"$tmp\"; }",
    "trap cleanup EXIT",
    "curl -L --max-time 25 -A 'vllm-studio-agent-browser/1.0' -sS \"$URL\" > \"$tmp\"",
    "title=$(tr '\\n' ' ' < \"$tmp\" | sed -n \"s:.*<title[^>]*>\\(.*\\)</title>.*:\\1:Ip\" | head -n 1 | sed 's/[[:space:]]\\+/ /g; s/^ //; s/ $//')",
    "if [ -z \"$title\" ]; then title='(no title found)'; fi",
    "preview=$(head -c 1400 \"$tmp\" | tr '\\n' ' ' | tr '\\r' ' ' | sed 's/[[:space:]]\\+/ /g; s/^ //; s/ $//')",
    "printf 'URL: %s\\nTitle: %s\\nPreview: %s\\n' \"$URL\" \"$title\" \"$preview\"",
  ].join("\n");

/**
 * Build agent tools that execute directly on the local machine with a sandboxed working directory.
 */
export const buildLocalTools = (context: AppContext, options: LocalToolOptions): AgentTool[] => {
  const sessionRoot = ensureSessionRoot(context, options.sessionId);

  const runCommandTool = async (
    params: unknown
  ): Promise<AgentToolResult<Record<string, unknown>>> => {
    try {
      const raw = asRecord(params);
      const payload = parseCommandPayload(raw);
      ensureCommandAllowed(payload.command);
      const cwd = resolveSandboxedCwd(sessionRoot, payload.cwd);
      const timeoutSeconds = clampTimeoutSeconds(payload.timeout, DEFAULT_TIMEOUT_SECONDS);

      const result = await executeLocal(payload.command, {
        cwd,
        timeoutSeconds,
      });
      const text = truncateText(result.result, MAX_OUTPUT_CHARS);
      return createTextResult(text, {
        exitCode: result.exitCode,
        signal: result.signal,
        cwd,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return createTextResult(`Error: ${message}`, { exitCode: 1, error: true });
    }
  };

  const executeCommand: AgentTool = {
    name: AGENT_TOOL_NAMES.EXECUTE_COMMAND,
    label: AGENT_TOOL_NAMES.EXECUTE_COMMAND,
    description: "Execute a shell command on the backend machine.",
    parameters: COMMAND_TOOL_PARAMETERS,
    execute: async (_toolCallId, params) => runCommandTool(params),
  };

  const computerUse: AgentTool = {
    name: AGENT_TOOL_NAMES.COMPUTER_USE,
    label: AGENT_TOOL_NAMES.COMPUTER_USE,
    description:
      "Use the backend machine shell directly. Accepts the same payload as execute_command.",
    parameters: COMMAND_TOOL_PARAMETERS,
    execute: async (_toolCallId, params) => runCommandTool(params),
  };

  const browserOpenUrl: AgentTool = {
    name: AGENT_TOOL_NAMES.BROWSER_OPEN_URL,
    label: AGENT_TOOL_NAMES.BROWSER_OPEN_URL,
    description:
      "Open and inspect a URL from the backend machine. Returns page title and preview text.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        href: { type: "string" },
        link: { type: "string" },
        uri: { type: "string" },
        website: { type: "string" },
        timeout: { type: "number" },
        timeout_ms: { type: "number" },
      },
      anyOf: [
        { required: ["url"] },
        { required: ["href"] },
        { required: ["link"] },
        { required: ["uri"] },
        { required: ["website"] },
      ],
    } as unknown as TSchema,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> => {
      const raw = asRecord(params);
      const urlInput =
        readStringArgument(raw, [
          "url",
          "href",
          "link",
          "uri",
          "website",
          "target",
          "input",
          "command",
        ]) ?? "";
      if (!urlInput) {
        throw new Error("url (or href/link/uri/website) is required");
      }

      const url = await validateBrowserUrl(urlInput);
      const timeoutSeconds = readPositiveNumberArgument(raw, ["timeout", "timeout_seconds", "timeoutSeconds"]);
      const timeoutMs = readPositiveNumberArgument(raw, ["timeout_ms", "timeoutMs"]);
      const timeout = clampTimeoutSeconds(
        timeoutSeconds ?? (timeoutMs !== undefined ? Math.ceil(timeoutMs / 1000) : undefined),
        35
      );

      const probeCommand = buildBrowserProbeCommand(url);
      const result = await executeLocal(probeCommand, {
        cwd: sessionRoot,
        timeoutSeconds: timeout,
      });
      const text = truncateText(result.result, 8000);

      return createTextResult(text, {
        url,
        exitCode: result.exitCode,
        signal: result.signal,
        cwd: sessionRoot,
      });
    },
  };

  return [executeCommand, computerUse, browserOpenUrl];
};
