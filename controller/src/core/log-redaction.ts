const REDACTED = "[redacted]";

const SECRET_VALUE = String.raw`(?:\\+"[^\r\n]*?\\+"(?=\s*[,}\]])|\\+'[^\r\n]*?\\+'(?=\s*[,}\]])|"(?:\\(?:[^\r\n]|(?=\r?\n|$))|[^"\\\r\n])*(?:"|(?=\r?\n|$))|'(?:\\(?:[^\r\n]|(?=\r?\n|$))|[^'\\\r\n])*(?:'|(?=\r?\n|$))|\[redacted\]|[^\s;,}"'\]]+)`;
const AUTHORIZATION_VALUE = String.raw`(?:"(?:\\[^\r\n]|[^"\\\r\n])*"|'(?:\\[^\r\n]|[^'\\\r\n])*'|[^\r\n}]*)`;

export function redactLogLine(line: string): string {
  let redacted = line;

  redacted = redacted.replace(
    new RegExp(
      String.raw`((?:\\*["'])?Authorization(?:\\*["'])?\s*[:=]\s*)` + AUTHORIZATION_VALUE,
      "gi",
    ),
    `$1${REDACTED}`,
  );

  // X-Api-Key style headers.
  redacted = redacted.replace(
    new RegExp(String.raw`([Xx]-[Aa]pi-[Kk]ey["']?\s*[:=]\s*)` + SECRET_VALUE, "g"),
    `$1${REDACTED}`,
  );

  // Env-style assignments: KEY=VALUE or export KEY=VALUE.
  // Covers explicit keys plus generic *_API_KEY / *_TOKEN patterns.
  redacted = redacted.replace(
    new RegExp(
      String.raw`((?<![A-Za-z0-9_])(?:HF_TOKEN|HUGGING_FACE_HUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|[A-Za-z_][A-Za-z0-9_]*_API_KEY|[A-Za-z_][A-Za-z0-9_]*_TOKEN)\s*=\s*)` +
        SECRET_VALUE,
      "gi",
    ),
    `$1${REDACTED}`,
  );

  redacted = redacted.replace(
    new RegExp(
      String.raw`((?:\\*["'])?(?:api_key|api-key|apikey|authorization|x-api-key|auth_token|access_token|token|secret|password|hf_token|openai_api_key|anthropic_api_key)(?:\\*["'])?\s*:\s*)` +
        SECRET_VALUE,
      "gi",
    ),
    `$1${REDACTED}`,
  );

  // CLI long flags: --api-key <value>, --hf-token <value>, etc.
  redacted = redacted.replace(
    new RegExp(
      String.raw`((?<![A-Za-z0-9_-])--(?:api-key|apikey|api_token|auth-token|access-token|hf-token|token|secret|password))(\s*=\s*|\s+|["']?\s*,\s*["']?)` +
        SECRET_VALUE,
      "gim",
    ),
    `$1$2${REDACTED}`,
  );

  // URL query parameters: api_key=..., token=..., etc.
  redacted = redacted.replace(
    /([?&])(api_key|api-key|apikey|token|access_token|auth_token|key|secret|hf_token|openai_api_key|anthropic_api_key)=([^&\s]*)/gi,
    `$1$2=${REDACTED}`,
  );

  return redacted;
}
