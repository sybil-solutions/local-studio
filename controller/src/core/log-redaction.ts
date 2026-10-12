/**
 * Conservative log-line redaction for API/SSE responses.
 *
 * Preserves raw log files on disk; only use this when serializing lines to
 * HTTP/SSE clients. The regexes are intentionally anchored to known secret
 * markers so ordinary error messages, file paths, ports, and throughput metrics
 * are not eaten.
 */

const REDACTED = "[redacted]";

/**
 * Token-like value that stops at common separators/punctuation so surrounding
 * log context (semicolons, commas, quotes) is preserved.
 */
const TOKEN = String.raw`[^\s;,"']+`;

/**
 * Redact common secret-bearing patterns from a single log line.
 *
 * Covered:
 * - Authorization: Bearer <token>
 * - X-Api-Key: <token>
 * - Env assignments: HF_TOKEN=..., OPENAI_API_KEY=..., *_API_KEY=..., *_TOKEN=..., *_SECRET=..., *_PASSWORD=...
 * - JSON-ish pairs: "api_key": "...", 'token': '...'
 * - CLI flags: --api-key <value>, --hf-token <value>, --token <value>, etc.
 * - URL query params: ?api_key=...&token=...&refresh_token=...&client_secret=...
 */
export function redactLogLine(line: string): string {
  let redacted = line;

  // Authorization / Bearer headers.
  redacted = redacted.replace(
    new RegExp(String.raw`(Authorization:\s*Bearer\s+)` + TOKEN, "gi"),
    `$1${REDACTED}`,
  );

  // X-Api-Key style headers.
  redacted = redacted.replace(
    new RegExp(String.raw`((?:^|[\r\n])[Xx]-[Aa]pi-[Kk]ey:\s+)` + TOKEN, "g"),
    `$1${REDACTED}`,
  );

  // Env-style assignments: KEY=VALUE or export KEY=VALUE.
  // Covers explicit keys plus generic *_API_KEY / *_TOKEN / *_SECRET / *_PASSWORD / *_SECRET_KEY / *_SECRET_ACCESS_KEY patterns.
  redacted = redacted.replace(
    new RegExp(
      String.raw`((?:^|[\s;{"'|&]|export\s+)(?:HF_TOKEN|HUGGING_FACE_HUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|[A-Za-z_][A-Za-z0-9_]*_API_KEY|[A-Za-z_][A-Za-z0-9_]*_TOKEN|[A-Za-z_][A-Za-z0-9_]*_SECRET_ACCESS_KEY|[A-Za-z_][A-Za-z0-9_]*_SECRET_KEY|[A-Za-z_][A-Za-z0-9_]*_SECRET|[A-Za-z_][A-Za-z0-9_]*_PASSWORD)\s*=\s*)(?:"[^"]*"|'[^']*'|` +
        TOKEN +
        ")",
      "g",
    ),
    `$1${REDACTED}`,
  );

  // JSON-ish key/value pairs: "api_key": "...", 'token': '...'.
  // Preserves the quote style of the value.
  redacted = redacted.replace(
    /(["']?(?:api_key|api-key|apikey|auth_token|access_token|token|secret|password|hf_token|openai_api_key|anthropic_api_key)["']?\s*:\s*)(["'])[^"']*\2/gi,
    `$1$2${REDACTED}$2`,
  );

  // CLI long flags: --api-key <value>, --hf-token <value>, etc.
  redacted = redacted.replace(
    new RegExp(
      String.raw`(\s)(--(?:api-key|apikey|api_token|auth-token|access-token|hf-token|token|secret|password))\s+` +
        TOKEN,
      "gi",
    ),
    `$1$2 ${REDACTED}`,
  );

  // URL query parameters: api_key=..., token=..., password=..., refresh_token=..., client_secret=..., etc.
  redacted = redacted.replace(
    /([?&])(api_key|api-key|apikey|token|access_token|auth_token|key|secret|hf_token|openai_api_key|anthropic_api_key|password|passwd|client_secret|refresh_token|id_token|session_token|secret_access_key)=([^&\s]*)/gi,
    `$1$2=${REDACTED}`,
  );

  return redacted;
}

/**
 * Line-wise redaction for a multi-line block — engine log tails that get
 * embedded into launch-failure messages and SSE events. Same rules, same
 * conservatism, applied per line so the anchored patterns still see the
 * line starts they expect.
 */
export function redactLogText(text: string): string {
  return text.split(/\r?\n/).map(redactLogLine).join("\n");
}
