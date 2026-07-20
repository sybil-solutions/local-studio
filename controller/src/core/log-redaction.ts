const REDACTED = "[redacted]";
const UNQUOTED_VALUE = String.raw`(?:\[redacted\]|[^\s,;}\]'"]+)`;
const AUTHORIZATION_SECRET_KEYS = ["authorization", "proxy_authorization"] as const;
const VALUE_SECRET_KEYS = [
  "api_key",
  "x_api_key",
  "auth_token",
  "access_token",
  "refresh_token",
  "token",
  "secret",
  "client_secret",
  "password",
  "passwd",
  "hf_token",
  "openai_api_key",
  "anthropic_api_key",
  "aws_secret_access_key",
  "private_key",
  "ssh_private_key",
  "signing_key",
  "jwt_signing_key",
  "encryption_key",
  "service_encryption_key",
  "secret_key",
  "pat",
  "github_pat",
  "gitlab_pat",
  "personal_access_token",
  "credential",
  "credentials",
  "client_credentials",
  "cookie",
  "set_cookie",
  "session_id",
  "database_url",
  "primary_database_url",
  "database_dsn",
  "sqlalchemy_database_uri",
  "redis_url",
  "postgres_dsn",
] as const;
const SECRET_KEY_SUFFIXES = [
  "api_key",
  "auth_token",
  "access_token",
  "refresh_token",
  "personal_access_token",
  "token",
  "private_key",
  "signing_key",
  "encryption_key",
  "secret_key",
  "pat",
  "credential",
  "credentials",
  "cookie",
  "session_id",
  "database_url",
  "database_uri",
  "database_dsn",
  "db_url",
  "db_uri",
  "db_dsn",
  "redis_url",
  "redis_uri",
  "redis_dsn",
  "postgres_url",
  "postgres_uri",
  "postgres_dsn",
  "postgresql_url",
  "postgresql_uri",
  "postgresql_dsn",
  "mysql_url",
  "mysql_uri",
  "mysql_dsn",
  "mariadb_url",
  "mariadb_uri",
  "mariadb_dsn",
  "mongo_url",
  "mongo_uri",
  "mongo_dsn",
  "mongodb_url",
  "mongodb_uri",
  "mongodb_dsn",
  "amqp_url",
  "amqp_uri",
  "amqp_dsn",
  "broker_url",
  "broker_uri",
  "broker_dsn",
  "connection_string",
  "dsn",
  "secret",
  "password",
  "passwd",
] as const;
const EXPLICIT_SECRET_KEYS = new Set(
  [...AUTHORIZATION_SECRET_KEYS, ...VALUE_SECRET_KEYS].map((key) => key.replaceAll("_", "")),
);
const MAX_SECRET_LABEL_CHARS = 256;
const MAX_ENCODED_QUERY_KEY_CHARS = MAX_SECRET_LABEL_CHARS * 3;
const SECRET_LABEL = String.raw`[A-Za-z_][A-Za-z0-9._-]{0,${MAX_SECRET_LABEL_CHARS - 1}}`;
const SECRET_LABEL_BOUNDARY = String.raw`[\s{[(,;:/|"'=<>]`;
const SECRET_VALUE_SEPARATOR = String.raw`(?::|=>|=(?!>))`;
const LABELED_SECRET_CANDIDATE = new RegExp(
  String.raw`(?=(?:^|${SECRET_LABEL_BOUNDARY})['"]?(${SECRET_LABEL})['"]?\s*${SECRET_VALUE_SEPARATOR})`,
  "gi",
);
const CLI_SECRET_CANDIDATE = new RegExp(
  String.raw`(?=(?:^|[\s,["'])--(${SECRET_LABEL})(?:\s+|=))`,
  "gi",
);
const SECRET_CLI_FLAG = new RegExp(String.raw`^--(${SECRET_LABEL})$`, "i");
const SPLIT_LABELED_SECRET = new RegExp(
  String.raw`(?:^|${SECRET_LABEL_BOUNDARY})['"]?(${SECRET_LABEL})['"]?\s*${SECRET_VALUE_SEPARATOR}(?:\s|[,;:=\\()[\]{}])*$`,
  "i",
);
const SPLIT_SECRET_LABEL = new RegExp(
  String.raw`(?:^|${SECRET_LABEL_BOUNDARY})['"]?(${SECRET_LABEL})['"]?\s*$`,
  "i",
);
const SPLIT_CLI_SECRET = new RegExp(
  String.raw`(?:^|[\s,["'])['"]?--(${SECRET_LABEL})['"]?(?:\s|[,;:=\\()[\]{}])*$`,
  "i",
);
const QUERY_VALUE_CANDIDATE = new RegExp(
  String.raw`([?&])([^=&\s]{1,${MAX_ENCODED_QUERY_KEY_CHARS}})=([^&\s]*)`,
  "g",
);
const QUERY_INTENT_CANDIDATE = new RegExp(
  String.raw`[?&]([^=&\s]{1,${MAX_ENCODED_QUERY_KEY_CHARS}})\s*(?:(=)\s*([,;:=\\()[\]{}]*))?\s*$`,
  "i",
);
const MAX_REDACTION_DEPTH = 24;

type ValueRedactor = (value: string) => string;

export interface LogPayloadRedactor {
  redact: (payload: string) => string;
  redactLine: (line: string) => string;
  stateKey: () => string;
  failClosed: () => void;
}

export interface LogRecordRedactor {
  redactLine: (line: string) => string;
  failClosed: () => void;
}

type LogRedactionState = "idle" | "separator" | "value" | "single-quote" | "double-quote";
type SecretIntent = "separator" | "value" | null;

const redactValue = (): string => REDACTED;

const redactAuthorizationValue = (value: string): string => {
  const scheme = /^([A-Za-z][A-Za-z0-9._~+/-]*)\s+/.exec(value)?.[1];
  return scheme ? `${scheme} ${REDACTED}` : REDACTED;
};

const normalizedSecretKey = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const isAuthorizationSecretKey = (key: string): boolean => {
  const normalized = normalizedSecretKey(key).replaceAll("_", "");
  return AUTHORIZATION_SECRET_KEYS.some(
    (candidate) => normalized === candidate.replaceAll("_", ""),
  );
};

const isRecognizedSecretKey = (key: string): boolean => {
  const normalized = normalizedSecretKey(key);
  return (
    EXPLICIT_SECRET_KEYS.has(normalized.replaceAll("_", "")) ||
    SECRET_KEY_SUFFIXES.some(
      (suffix) => normalized === suffix || normalized.endsWith(`_${suffix}`),
    )
  );
};

const escapedPattern = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const recognizedLabels = (line: string, pattern: RegExp): string[] =>
  Array.from(
    new Set(
      Array.from(line.matchAll(pattern), (match) => match[1] ?? "").filter(
        isRecognizedSecretKey,
      ),
    ),
  );

const recognizedSecretMatch = (line: string, pattern: RegExp): boolean => {
  const key = pattern.exec(line)?.[1];
  return key !== undefined && isRecognizedSecretKey(key);
};

const isSecretCliFlag = (value: string): boolean => {
  const key = SECRET_CLI_FLAG.exec(value)?.[1];
  return key !== undefined && isRecognizedSecretKey(key);
};

type QueryKeyClassification = "secret" | "ordinary" | "malformed";

const queryKeyClassification = (key: string): QueryKeyClassification => {
  if (key.length > MAX_ENCODED_QUERY_KEY_CHARS) return "ordinary";
  try {
    const decoded = decodeURIComponent(key.replaceAll("+", " "));
    if (decoded.length > MAX_SECRET_LABEL_CHARS) return "ordinary";
    return isRecognizedSecretKey(decoded) ? "secret" : "ordinary";
  } catch {
    return "malformed";
  }
};

const redactQueryValues = (line: string): string =>
  line.replace(
    QUERY_VALUE_CANDIDATE,
    (match: string, boundary: string, key: string) =>
      queryKeyClassification(key) === "ordinary"
        ? match
        : `${boundary}${key}=${REDACTED}`,
  );

const redactLabeledValues = (
  line: string,
  label: string,
  separator: string,
  valueRedactor: ValueRedactor,
  unquotedValue = UNQUOTED_VALUE,
): string => {
  const prefix = String.raw`((?:^|${SECRET_LABEL_BOUNDARY})['"]?(?:${label})['"]?\s*${separator}\s*)`;
  const doubleQuoted = new RegExp(`${prefix}"((?:\\\\.|[^"\\\\])*)"`, "gi");
  const singleQuoted = new RegExp(`${prefix}'((?:\\\\.|[^'\\\\])*)'`, "gi");
  const unterminatedDouble = new RegExp(`${prefix}"(?:\\\\.|[^"\\\\\r\n])*(?=$|\r?\n)`, "gim");
  const unterminatedSingle = new RegExp(`${prefix}'(?:\\\\.|[^'\\\\\r\n])*(?=$|\r?\n)`, "gim");
  const unquoted = new RegExp(`${prefix}(?!["'])(${unquotedValue})`, "gi");
  return line
    .replace(
      doubleQuoted,
      (_match: string, matchedPrefix: string, value: string) =>
        `${matchedPrefix}"${valueRedactor(value)}"`,
    )
    .replace(
      singleQuoted,
      (_match: string, matchedPrefix: string, value: string) =>
        `${matchedPrefix}'${valueRedactor(value)}'`,
    )
    .replace(
      unterminatedDouble,
      (_match: string, matchedPrefix: string) => `${matchedPrefix}"${REDACTED}`,
    )
    .replace(
      unterminatedSingle,
      (_match: string, matchedPrefix: string) => `${matchedPrefix}'${REDACTED}`,
    )
    .replace(
      unquoted,
      (_match: string, matchedPrefix: string, value: string) =>
        `${matchedPrefix}${valueRedactor(value)}`,
    );
};

const redactCliLabelValues = (line: string, key: string): string => {
  const label = escapedPattern(key);
  const prefix = String.raw`(^|[\s,["'])(--${label})(\s+|=)`;
  const arrayPrefix = String.raw`((?:["']--${label}["'])\s*,\s*)`;
  return line
    .replace(
      new RegExp(`${prefix}"((?:\\\\.|[^"\\\\])*)"`, "gi"),
      (_match: string, boundary: string, key: string, separator: string) =>
        `${boundary}${key}${separator}"${REDACTED}"`,
    )
    .replace(
      new RegExp(`${prefix}'((?:\\\\.|[^'\\\\])*)'`, "gi"),
      (_match: string, boundary: string, key: string, separator: string) =>
        `${boundary}${key}${separator}'${REDACTED}'`,
    )
    .replace(
      new RegExp(`${prefix}"(?:\\\\.|[^"\\\\\r\n])*(?=$|\r?\n)`, "gim"),
      (_match: string, boundary: string, key: string, separator: string) =>
        `${boundary}${key}${separator}"${REDACTED}`,
    )
    .replace(
      new RegExp(`${prefix}'(?:\\\\.|[^'\\\\\r\n])*(?=$|\r?\n)`, "gim"),
      (_match: string, boundary: string, key: string, separator: string) =>
        `${boundary}${key}${separator}'${REDACTED}`,
    )
    .replace(
      new RegExp(`${prefix}(?!["'])${UNQUOTED_VALUE}`, "gi"),
      (_match: string, boundary: string, key: string, separator: string) =>
        `${boundary}${key}${separator}${REDACTED}`,
    )
    .replace(new RegExp(`${arrayPrefix}"(?:\\\\.|[^"\\\\])*"`, "gi"), `$1"${REDACTED}"`)
    .replace(new RegExp(`${arrayPrefix}'(?:\\\\.|[^'\\\\])*'`, "gi"), `$1'${REDACTED}'`);
};

const redactCliValues = (line: string): string =>
  recognizedLabels(line, CLI_SECRET_CANDIDATE).reduce(redactCliLabelValues, line);

const redactScalarLine = (line: string): string => {
  const labeledRedacted = recognizedLabels(line, LABELED_SECRET_CANDIDATE).reduce(
    (output, key) =>
      redactLabeledValues(
        output,
        escapedPattern(key),
        SECRET_VALUE_SEPARATOR,
        isAuthorizationSecretKey(key) ? redactAuthorizationValue : redactValue,
        isAuthorizationSecretKey(key) ? String.raw`[^\s"'\r\n][^\r\n]*` : UNQUOTED_VALUE,
      ),
    line,
  );
  const cliRedacted = redactCliValues(labeledRedacted);
  return redactQueryValues(cliRedacted);
};

const closingQuoteIndex = (line: string, start: number, quote: string): number => {
  for (let index = start; index < line.length; index += 1) {
    if (line[index] !== quote) continue;
    let escapes = 0;
    for (let cursor = index - 1; cursor >= start && line[cursor] === "\\"; cursor -= 1) {
      escapes += 1;
    }
    if (escapes % 2 === 0) return index;
  }
  return -1;
};

const secretQuotePatterns = [
  new RegExp(
    String.raw`(?:^|${SECRET_LABEL_BOUNDARY})['"]?(${SECRET_LABEL})['"]?\s*${SECRET_VALUE_SEPARATOR}\s*(["'])`,
    "gi",
  ),
  new RegExp(String.raw`(?:^|[\s,["'])--(${SECRET_LABEL})(?:\s+|=)(["'])`, "gi"),
];

const unterminatedSecretQuote = (line: string): "'" | '"' | null => {
  for (const pattern of secretQuotePatterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(line);
    while (match) {
      const key = match[1];
      const quote = match[2];
      if (key && isRecognizedSecretKey(key) && (quote === "'" || quote === '"')) {
        const openingIndex = match.index + match[0].lastIndexOf(quote);
        if (closingQuoteIndex(line, openingIndex + 1, quote) < 0) return quote;
      }
      match = pattern.exec(line);
    }
  }
  return null;
};

const querySecretIntent = (line: string): SecretIntent => {
  const match = QUERY_INTENT_CANDIDATE.exec(line);
  const key = match?.[1];
  if (!key || queryKeyClassification(key) === "ordinary") return null;
  return match[2] === "=" ? "value" : "separator";
};

const secretIntent = (line: string): SecretIntent => {
  const queryIntent = querySecretIntent(line);
  if (queryIntent) return queryIntent;
  if (
    recognizedSecretMatch(line, SPLIT_LABELED_SECRET) ||
    recognizedSecretMatch(line, SPLIT_CLI_SECRET)
  ) {
    return "value";
  }
  return recognizedSecretMatch(line, SPLIT_SECRET_LABEL) ? "separator" : null;
};

const pendingValueReset = (line: string): boolean => /^\s*[\]})]+[,;]?\s*$/.test(line);
const pendingSeparator = /^\s*(?::|=>|=(?!>))\s*/;

const pendingValueSyntax = (line: string): boolean => {
  const compact = line.replace(/\s/g, "");
  return compact.length === 0 || /^[,;:=\\([{]*$/.test(compact);
};

const unterminatedPendingValueQuote = (line: string): "'" | '"' | null => {
  const match = /^\s*(?:[-=:,[{(]\s*)*(['"])/.exec(line);
  const quote = match?.[1];
  if (quote !== "'" && quote !== '"') return null;
  const opening = match?.[0].lastIndexOf(quote) ?? -1;
  return closingQuoteIndex(line, opening + 1, quote) < 0 ? quote : null;
};

const redactPendingValue = (line: string): string => `${/^\s*/.exec(line)?.[0] ?? ""}${REDACTED}`;

const redactStructuredArray = (
  values: readonly unknown[],
  seen: WeakMap<object, unknown>,
  depth: number,
): unknown[] => {
  const redacted: unknown[] = [];
  seen.set(values, redacted);
  let redactNext = false;
  for (const value of values) {
    if (redactNext) {
      redacted.push(REDACTED);
      redactNext = false;
      continue;
    }
    if (typeof value === "string" && isSecretCliFlag(value)) {
      redacted.push(value);
      redactNext = true;
      continue;
    }
    redacted.push(redactStructuredValue(value, seen, depth + 1));
  }
  return redacted;
};

const redactStructuredObject = (
  value: object,
  seen: WeakMap<object, unknown>,
  depth: number,
): Record<string, unknown> => {
  const redacted: Record<string, unknown> = {};
  seen.set(value, redacted);
  for (const [key, nested] of Object.entries(value)) {
    if (isRecognizedSecretKey(key)) {
      redacted[key] =
        isAuthorizationSecretKey(key) && typeof nested === "string"
          ? redactAuthorizationValue(nested)
          : REDACTED;
    } else {
      redacted[key] = redactStructuredValue(nested, seen, depth + 1);
    }
  }
  if (value instanceof Error) {
    redacted["name"] = value.name;
    redacted["message"] = redactLogPayload(value.message);
    if (value.stack) redacted["stack"] = redactLogPayload(value.stack);
    if (value.cause !== undefined) {
      redacted["cause"] = redactStructuredValue(value.cause, seen, depth + 1);
    }
  }
  return redacted;
};

const redactStructuredValue = (
  value: unknown,
  seen: WeakMap<object, unknown>,
  depth: number,
): unknown => {
  if (typeof value === "string") return redactLogPayload(value);
  if (value === null || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  if (depth >= MAX_REDACTION_DEPTH) return REDACTED;
  if (Array.isArray(value)) return redactStructuredArray(value, seen, depth);
  return redactStructuredObject(value, seen, depth);
};

export const redactLogValue = (value: unknown): unknown =>
  redactStructuredValue(value, new WeakMap<object, unknown>(), 0);

const redactJson = (payload: string): string | null => {
  const trimmed = payload.trim();
  if (
    !(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
    !(trimmed.startsWith("[") && trimmed.endsWith("]"))
  )
    return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const serialized = JSON.stringify(redactLogValue(parsed));
    if (serialized === undefined) return null;
    const start = payload.indexOf(trimmed);
    return `${payload.slice(0, start)}${serialized}${payload.slice(start + trimmed.length)}`;
  } catch {
    return null;
  }
};

export const createLogPayloadRedactor = (
  initialState: LogRedactionState = "idle",
): LogPayloadRedactor => {
  let state = initialState;

  const setPendingValueState = (line: string): void => {
    const quote = unterminatedPendingValueQuote(line);
    state =
      quote === "'"
        ? "single-quote"
        : quote === '"'
          ? "double-quote"
          : (secretIntent(line) ?? "idle");
  };

  const redactLine = (line: string): string => {
    if (state === "single-quote" || state === "double-quote") {
      const quote = state === "single-quote" ? "'" : '"';
      const closing = closingQuoteIndex(line, 0, quote);
      if (closing < 0) return REDACTED;
      state = "idle";
      return `${REDACTED}${quote}${redactLine(line.slice(closing + 1))}`;
    }
    if (state === "separator") {
      if (pendingValueReset(line)) {
        state = "idle";
        return redactScalarLine(line);
      }
      const separator = pendingSeparator.exec(line);
      if (separator) {
        const remainder = line.slice(separator[0].length);
        if (pendingValueSyntax(remainder)) {
          state = "value";
          return redactScalarLine(line);
        }
        setPendingValueState(line);
        return redactPendingValue(line);
      }
      const intent = secretIntent(line);
      if (intent) {
        state = intent;
        return redactScalarLine(line);
      }
      if (pendingValueSyntax(line)) return redactScalarLine(line);
      return redactScalarLine(line);
    }
    if (state === "value") {
      if (pendingValueReset(line)) {
        state = "idle";
        return redactScalarLine(line);
      }
      if (pendingValueSyntax(line)) return redactScalarLine(line);
      setPendingValueState(line);
      return redactPendingValue(line);
    }
    const quote = unterminatedSecretQuote(line);
    if (quote) {
      state = quote === "'" ? "single-quote" : "double-quote";
      return redactScalarLine(line);
    }
    const intent = secretIntent(line);
    if (intent) {
      state = intent;
      return redactScalarLine(line);
    }
    const json = redactJson(line);
    if (json !== null) return json;
    state = "idle";
    return redactScalarLine(line);
  };

  const redact = (payload: string): string => {
    const segments = payload.split(/(\r?\n)/);
    return segments
      .map((segment) => (segment === "\n" || segment === "\r\n" ? segment : redactLine(segment)))
      .join("");
  };

  const failClosed = (): void => {
    if (state !== "single-quote" && state !== "double-quote") state = "value";
  };

  return { redact, redactLine, stateKey: () => state, failClosed };
};

export const createLogRecordRedactor = (knownStart: boolean): LogRecordRedactor => {
  if (knownStart) return createLogPayloadRedactor();
  let candidates: LogPayloadRedactor[] = [
    createLogPayloadRedactor(),
    createLogPayloadRedactor("separator"),
    createLogPayloadRedactor("value"),
    createLogPayloadRedactor("single-quote"),
    createLogPayloadRedactor("double-quote"),
  ];

  return {
    redactLine(line: string): string {
      const outputs = candidates.map((candidate) => candidate.redactLine(line));
      const states = new Map<string, LogPayloadRedactor>();
      for (const candidate of candidates) states.set(candidate.stateKey(), candidate);
      candidates = Array.from(states.values());
      return new Set(outputs).size === 1 ? (outputs[0] ?? REDACTED) : REDACTED;
    },
    failClosed(): void {
      for (const candidate of candidates) candidate.failClosed();
    },
  };
};

export const redactLogPayload = (payload: string): string =>
  createLogPayloadRedactor().redact(payload);

export function redactLogLine(line: string): string {
  return redactLogPayload(line);
}
