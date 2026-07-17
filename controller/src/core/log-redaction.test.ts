import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format } from "node:util";
import { installConsoleRedaction } from "./console-redaction";
import { createLogger } from "./logger";
import { createLogPayloadRedactor, redactLogLine, redactLogValue } from "./log-redaction";

const SECRET = "SYNTHETIC_UNIT_REDACTION_SECRET";
const QUERY_SECRET = "SYNTHETIC_PROBE_SECRET";
const QUERY_PREFIX = "https://service.invalid/path?process.env.ACCESS_TOKEN=";
const ENCODED_QUERY_PREFIX =
  "https://service.invalid/path?process%2Eenv%2EACCESS_TOKEN=";
const NORMALIZED_SECRET_LABELS = [
  "process.env.ACCESS_TOKEN",
  "OPENAI__API__KEY",
  "service.config--refresh__token",
  "runtime-secrets.__private--key",
] as const;

const EXTENDED_SECRET_KEYS = [
  "PRIVATE_KEY",
  "SSH_PRIVATE_KEY",
  "JWT_SIGNING_KEY",
  "SERVICE_ENCRYPTION_KEY",
  "SERVICE_SECRET_KEY",
  "GITHUB_PAT",
  "GITLAB_PAT",
  "PERSONAL_ACCESS_TOKEN",
  "CLIENT_CREDENTIALS",
  "COOKIE",
  "SET_COOKIE",
  "SESSION_ID",
  "DATABASE_URL",
  "PRIMARY_DATABASE_URL",
  "DATABASE_DSN",
  "SQLALCHEMY_DATABASE_URI",
  "REDIS_URL",
  "POSTGRES_DSN",
  "sshPrivateKey",
  "jwtSigningKey",
  "serviceEncryptionKey",
  "githubPat",
  "personalAccessToken",
  "clientCredentials",
  "setCookie",
  "sessionId",
  "primaryDatabaseUrl",
  "sqlalchemyDatabaseUri",
  "redisUrl",
  "postgresDsn",
] as const;

const NON_SECRET_KEYS = [
  "PUBLIC_KEY",
  "SIGNING_KEY_ID",
  "ENCRYPTION_KEY_ALGORITHM",
  "ACCESS_TOKEN_COUNT",
  "CREDENTIAL_TYPE",
  "COOKIE_POLICY",
  "SESSION_ID_COUNT",
  "DATABASE_URL_TEMPLATE",
  "DOCUMENTATION_URL",
  "DSN_SCHEME",
  "publicKey",
  "signingKeyId",
  "encryptionKeyAlgorithm",
  "accessTokenCount",
  "credentialType",
  "cookiePolicy",
  "sessionIdCount",
  "databaseUrlTemplate",
  "documentationUrl",
  "dsnScheme",
] as const;

const URL_SECRET_KEYS = [
  "api_key",
  "api-key",
  "APIKEY",
  "x-api-key",
  "x_api_key",
  "authorization",
  "Authorization",
  "proxy-authorization",
  "proxy_authorization",
  "proxyauthorization",
  "auth-token",
  "auth_token",
  "access-token",
  "access_token",
  "refresh-token",
  "refresh_token",
  "token",
  "secret",
  "client-secret",
  "client_secret",
  "password",
  "passwd",
  "hf-token",
  "hf_token",
  "openai-api-key",
  "openai_api_key",
  "anthropic-api-key",
  "anthropic_api_key",
  "aws-secret-access-key",
  "AWS_SECRET_ACCESS_KEY",
  "service-api-key",
  "SERVICE_API_KEY",
  "service-token",
  "SERVICE_TOKEN",
  "service-secret",
  "SERVICE_SECRET",
  "service-password",
  "SERVICE_PASSWORD",
] as const;

test("redacts every recognized URL credential key at either query boundary", () => {
  for (const key of URL_SECRET_KEYS) {
    const value = key.toLowerCase().includes("authorization") ? `Bearer%20${SECRET}` : SECRET;
    for (const prefix of ["?", "?ordinary=value&"]) {
      const output = redactLogLine(`https://service.invalid/status${prefix}${key}=${value}`);
      expect(output).not.toContain(SECRET);
      expect(output).toContain("[redacted]");
    }
    expect(redactLogLine(`${key}=${value}`)).not.toContain(SECRET);
    expect(JSON.stringify(redactLogValue({ [key]: value }))).not.toContain(SECRET);
  }
});

test("redacts extended credential semantics across scalar query and structured boundaries", () => {
  for (const key of EXTENDED_SECRET_KEYS) {
    const scalar = redactLogLine(`${key}=${SECRET}`);
    const query = redactLogLine(`https://service.invalid/status?${key}=${SECRET}`);
    const structured = JSON.stringify(redactLogValue({ [key]: SECRET }));
    const environment = JSON.stringify(redactLogValue({ env: { [key]: SECRET } }));
    for (const output of [scalar, query, structured, environment]) {
      expect(output).not.toContain(SECRET);
      expect(output).toContain("[redacted]");
    }
  }
});

test("preserves bounded non-secret key metadata", () => {
  for (const key of NON_SECRET_KEYS) {
    expect(redactLogLine(`${key}=${SECRET}`)).toBe(`${key}=${SECRET}`);
    expect(redactLogLine(`https://service.invalid/status?${key}=${SECRET}`)).toContain(SECRET);
    expect(JSON.stringify(redactLogValue({ [key]: SECRET }))).toContain(SECRET);
  }
});

test("normalizes bounded scalar environment CLI and split labels", () => {
  for (const key of NORMALIZED_SECRET_LABELS) {
    const outputs = [
      redactLogLine(`${key}=${SECRET}`),
      redactLogLine(`--${key}=${SECRET}`),
      redactLogLine(`https://service.invalid/status?${key}=${SECRET}`),
      JSON.stringify(redactLogValue({ [key]: SECRET })),
      JSON.stringify(redactLogValue({ env: { [key]: SECRET } })),
    ];
    for (const output of outputs) {
      expect(output).not.toContain(SECRET);
      expect(output).toContain("[redacted]");
    }
  }

  for (const lines of [
    ["process.env.ACCESS_TOKEN", "=", SECRET],
    ["--OPENAI__API__KEY", "=", SECRET],
  ]) {
    const redactor = createLogPayloadRedactor();
    const output = lines.map(redactor.redactLine).join("\n");
    expect(output).not.toContain(SECRET);
    expect(output).toContain("[redacted]");
  }
});

test("preserves ordinary dotted and repeated-separator configuration labels", () => {
  const inputs = [
    `config.logging.level=${SECRET}`,
    `process.env.ACCESS_TOKEN_COUNT=${SECRET}`,
    `service.database.url.template=${SECRET}`,
    `runtime.cookie.policy=${SECRET}`,
    `--config.logging__level=${SECRET}`,
    `config.${"ordinary.".repeat(20)}level=${SECRET}`,
  ];

  for (const input of inputs) expect(redactLogLine(input)).toBe(input);
});

test("retains normalized query intent across records without broadening non-secret labels", () => {
  const redactor = createLogPayloadRedactor();
  const output = [redactor.redactLine(QUERY_PREFIX), redactor.redactLine(QUERY_SECRET)].join("\n");
  const ordinary = createLogPayloadRedactor();
  const ordinaryLines = [
    "https://service.invalid/path?process.env.ACCESS_TOKEN_COUNT=",
    QUERY_SECRET,
    "https://service.invalid/path?config.logging.level=ordinary",
  ];

  expect(output).not.toContain(QUERY_SECRET);
  expect(output).toContain("[redacted]");
  expect(ordinaryLines.map(ordinary.redactLine).join("\n")).toBe(ordinaryLines.join("\n"));
});

test("retains percent-decoded query value intent across records", () => {
  for (const key of [
    "access%5Ftoken",
    "process%2Eenv%2EACCESS_TOKEN",
    "aCcEsS%5ftOkEn",
    "%61ccess_token",
  ]) {
    const redactor = createLogPayloadRedactor();
    const output = [
      redactor.redactLine(`https://service.invalid/path?${key}=`),
      redactor.redactLine(QUERY_SECRET),
    ].join("\n");
    expect(output).not.toContain(QUERY_SECRET);
    expect(output).toContain("[redacted]");
  }
});

test("retains percent-decoded query separator intent across records", () => {
  const redactor = createLogPayloadRedactor();
  const output = [
    redactor.redactLine("https://service.invalid/path?access%5Ftoken"),
    redactor.redactLine("="),
    redactor.redactLine(QUERY_SECRET),
  ].join("\n");

  expect(output).not.toContain(QUERY_SECRET);
  expect(output).toContain("[redacted]");
});

test("fails closed on malformed percent query value intent", () => {
  for (const key of ["access%5token", "%E0%A4%A", "access_token%"] as const) {
    const redactor = createLogPayloadRedactor();
    const output = [
      redactor.redactLine(`https://service.invalid/path?${key}=`),
      redactor.redactLine(QUERY_SECRET),
    ].join("\n");
    expect(output).not.toContain(QUERY_SECRET);
    expect(output).toContain("[redacted]");
  }
});

test("fails closed on malformed percent query separator intent", () => {
  const redactor = createLogPayloadRedactor();
  const output = [
    redactor.redactLine("https://service.invalid/path?access%5token"),
    redactor.redactLine("="),
    redactor.redactLine(QUERY_SECRET),
  ].join("\n");

  expect(output).not.toContain(QUERY_SECRET);
  expect(output).toContain("[redacted]");
});

test("preserves later ordinary query parameters exactly", () => {
  expect(
    redactLogLine(
      `https://service.invalid/path?ACCESS_TOKEN=${QUERY_SECRET}&status=healthy`,
    ),
  ).toBe("https://service.invalid/path?ACCESS_TOKEN=[redacted]&status=healthy");
  expect(
    redactLogLine(
      `https://service.invalid/path?mode=probe&ACCESS_TOKEN=${QUERY_SECRET}&status=healthy`,
    ),
  ).toBe(
    "https://service.invalid/path?mode=probe&ACCESS_TOKEN=[redacted]&status=healthy",
  );
});

test("preserves non-secret query continuations exactly", () => {
  for (const key of ["ACCESS_TOKEN_COUNT", "ACCESS%5FTOKEN%5FCOUNT"] as const) {
    const redactor = createLogPayloadRedactor();
    const lines = [
      `https://service.invalid/path?${key}=`,
      QUERY_SECRET,
      "ordinary query diagnostic",
    ];
    expect(lines.map(redactor.redactLine)).toEqual(lines);
  }
});

test("decodes query keys exactly once", () => {
  const input = `https://service.invalid/path?access%255Ftoken=${QUERY_SECRET}`;
  expect(redactLogLine(input)).toBe(input);
});

test("bounds encoded query key classification", () => {
  const key = `${"ordinary.".repeat(100)}ACCESS_TOKEN`;
  const input = `https://service.invalid/path?${key}=${QUERY_SECRET}`;
  const redactor = createLogPayloadRedactor();
  expect(redactLogLine(input)).toBe(input);
  expect(
    [redactor.redactLine(`https://service.invalid/path?${key}=`), redactor.redactLine(QUERY_SECRET)],
  ).toEqual([`https://service.invalid/path?${key}=`, QUERY_SECRET]);
});

test("fails closed on malformed percent single-record query values", () => {
  expect(
    redactLogLine(
      `https://service.invalid/path?access%ZZtoken=${QUERY_SECRET}&status=healthy`,
    ),
  ).toBe("https://service.invalid/path?access%ZZtoken=[redacted]&status=healthy");
});

test("redacts encoded query continuations before logger file and event sinks", async () => {
  const output: string[] = [];
  const directory = mkdtempSync(join(tmpdir(), "local-studio-logger-encoded-query-redaction-"));
  const filePath = join(directory, "controller.log");
  const originalInfo = console.info;
  console.info = (): void => undefined;
  try {
    const logger = createLogger("info", {
      filePath,
      onLine: (line) => {
        output.push(line);
      },
    });
    logger.info(ENCODED_QUERY_PREFIX);
    logger.info(QUERY_SECRET);
    let persisted = "";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      persisted = readFileSync(filePath, "utf8");
      if (persisted.split("\n").length >= 3) break;
      await Bun.sleep(5);
    }
    expect(`${persisted}\n${output.join("\n")}`).not.toContain(QUERY_SECRET);
    expect(`${persisted}\n${output.join("\n")}`).toContain("[redacted]");
  } finally {
    console.info = originalInfo;
    rmSync(directory, { recursive: true, force: true });
  }
  expect(output).toHaveLength(2);
});

test("redacts structured secret values without damaging diagnostic context", () => {
  const cases = [
    `Authorization: Bearer ${SECRET}`,
    `{"api_key":"${SECRET}\\\"suffix"}`,
    `Map(1) { 'client_secret' => '${SECRET} value' }`,
    `api_key="${SECRET}`,
    `export SERVICE_PASSWORD="${SECRET} value"`,
    `run --api-key='${SECRET} value'`,
    `run --api_key='${SECRET} value'`,
    `Proxy-Authorization: Basic ${SECRET}`,
    `Authorization: AWS4-HMAC-SHA256 Credential=${SECRET}, SignedHeaders=host, Signature=${SECRET}`,
    `Authorization: Digest username=${SECRET}, response=${SECRET}`,
    `AWS_SECRET_ACCESS_KEY=${SECRET}`,
    `https://service.invalid/status?access_token=${SECRET}&detail=full`,
  ];

  for (const input of cases) {
    const output = redactLogLine(input);
    expect(output).not.toContain(SECRET);
    expect(output).toContain("[redacted]");
    expect(redactLogLine(output)).toBe(output);
  }

  expect(redactLogLine("CUDA out of memory after allocating 4 GiB")).toBe(
    "CUDA out of memory after allocating 4 GiB",
  );
});

test("redacts serialized error and argv reviewer probes", () => {
  const probes = [
    JSON.stringify({ error: `Authorization: Bearer ${SECRET}` }),
    JSON.stringify({ error: `OPENAI_API_KEY=${SECRET}` }),
    JSON.stringify({ argv: ["tool", "--api-key", SECRET] }),
    JSON.stringify({ argv: ["tool", "--api_key", SECRET] }),
  ];

  for (const probe of probes) {
    const redacted = redactLogLine(probe);
    expect(redacted).not.toContain(SECRET);
    expect(redacted).toContain("[redacted]");
  }

  const structured = redactLogValue({
    error: new Error(`Authorization: Bearer ${SECRET}`),
    env: { OPENAI_API_KEY: SECRET },
    argv: ["tool", "--api-key", SECRET],
    proxyAuthorization: `Digest response=${SECRET}`,
    AWS_SECRET_ACCESS_KEY: SECRET,
  });
  expect(JSON.stringify(structured)).not.toContain(SECRET);
});

test("redacts normalized credentials before logger console file and event sinks", async () => {
  const output: string[] = [];
  const directory = mkdtempSync(join(tmpdir(), "local-studio-logger-redaction-"));
  const filePath = join(directory, "controller.log");
  const originalInfo = console.info;
  console.info = (value: unknown): void => {
    output.push(String(value));
  };
  try {
    const logger = createLogger("info", {
      filePath,
      onLine: (line) => {
        output.push(line);
      },
    });
    logger.info(
      `process.env.ACCESS_TOKEN=${SECRET} OPENAI__API__KEY=${SECRET} DATABASE_URL=${SECRET}`,
      {
        SSH_PRIVATE_KEY: SECRET,
        GITHUB_PAT: SECRET,
        JWT_SIGNING_KEY: SECRET,
      },
    );
    let persisted = "";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      persisted = readFileSync(filePath, "utf8");
      if (persisted.endsWith("\n")) break;
      await Bun.sleep(5);
    }
    expect(output.join("\n")).not.toContain(SECRET);
    expect(output.join("\n")).toContain("[redacted]");
    expect(persisted).not.toContain(SECRET);
    expect(persisted).toContain("[redacted]");
  } finally {
    console.info = originalInfo;
    rmSync(directory, { recursive: true, force: true });
  }
  expect(output).toHaveLength(2);
});

test("redacts query continuations before logger file and event sinks", async () => {
  const output: string[] = [];
  const directory = mkdtempSync(join(tmpdir(), "local-studio-logger-query-redaction-"));
  const filePath = join(directory, "controller.log");
  const originalInfo = console.info;
  console.info = (): void => undefined;
  try {
    const logger = createLogger("info", {
      filePath,
      onLine: (line) => {
        output.push(line);
      },
    });
    logger.info(QUERY_PREFIX);
    logger.info(QUERY_SECRET);
    let persisted = "";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      persisted = readFileSync(filePath, "utf8");
      if (persisted.split("\n").length >= 3) break;
      await Bun.sleep(5);
    }
    expect(`${persisted}\n${output.join("\n")}`).not.toContain(QUERY_SECRET);
    expect(`${persisted}\n${output.join("\n")}`).toContain("[redacted]");
  } finally {
    console.info = originalInfo;
    rmSync(directory, { recursive: true, force: true });
  }
  expect(output).toHaveLength(2);
});

test("retains redaction state across quoted multiline payloads", () => {
  const continuation = "SYNTHETIC_MULTILINE_CONTINUATION";
  const redactor = createLogPayloadRedactor();
  const output = [
    redactor.redactLine(`api_key="${SECRET}`),
    redactor.redactLine(continuation),
    redactor.redactLine('end" trailing diagnostic'),
  ].join("\n");

  expect(output).not.toContain(SECRET);
  expect(output).not.toContain(continuation);
  expect(output).toContain("trailing diagnostic");
  expect(output.match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(3);
});

test("redacts split structured and argv values before resetting pending state", () => {
  const structured = createLogPayloadRedactor();
  const structuredOutput = [
    structured.redactLine("{"),
    structured.redactLine('  "api_key":'),
    structured.redactLine(""),
    structured.redactLine('  "SYNTHETIC_SPLIT_STRUCTURED_SECRET"'),
    structured.redactLine("}"),
    structured.redactLine("ordinary structured diagnostic"),
  ].join("\n");
  const argv = createLogPayloadRedactor();
  const argvOutput = [
    argv.redactLine("["),
    argv.redactLine('  "--api-key",'),
    argv.redactLine(","),
    argv.redactLine('  "SYNTHETIC_SPLIT_ARGV_SECRET"'),
    argv.redactLine("]"),
    argv.redactLine("ordinary argv diagnostic"),
  ].join("\n");
  const reset = createLogPayloadRedactor();
  const resetOutput = [
    reset.redactLine('"api_key":'),
    reset.redactLine("}"),
    reset.redactLine("ordinary reset diagnostic"),
  ].join("\n");
  const chained = createLogPayloadRedactor();
  const chainedOutput = [
    chained.redactLine('"api_key":'),
    chained.redactLine('"SYNTHETIC_CHAINED_FIRST", "token":'),
    chained.redactLine('"SYNTHETIC_CHAINED_SECOND"'),
    chained.redactLine("ordinary chained diagnostic"),
  ].join("\n");
  const quoted = createLogPayloadRedactor();
  const quotedOutput = [
    quoted.redactLine('"api_key":'),
    quoted.redactLine('"SYNTHETIC_PENDING_QUOTED_FIRST'),
    quoted.redactLine("SYNTHETIC_PENDING_QUOTED_CONTINUATION"),
    quoted.redactLine('end", "token":'),
    quoted.redactLine('"SYNTHETIC_PENDING_QUOTED_SECOND"'),
    quoted.redactLine("ordinary quoted diagnostic"),
  ].join("\n");

  expect(structuredOutput).not.toContain("SYNTHETIC_SPLIT_STRUCTURED_SECRET");
  expect(structuredOutput).toContain("ordinary structured diagnostic");
  expect(argvOutput).not.toContain("SYNTHETIC_SPLIT_ARGV_SECRET");
  expect(argvOutput).toContain("ordinary argv diagnostic");
  expect(resetOutput).toContain("ordinary reset diagnostic");
  expect(chainedOutput).not.toContain("SYNTHETIC_CHAINED_FIRST");
  expect(chainedOutput).not.toContain("SYNTHETIC_CHAINED_SECOND");
  expect(chainedOutput).toContain("ordinary chained diagnostic");
  expect(quotedOutput).not.toContain("SYNTHETIC_PENDING_QUOTED_FIRST");
  expect(quotedOutput).not.toContain("SYNTHETIC_PENDING_QUOTED_CONTINUATION");
  expect(quotedOutput).not.toContain("SYNTHETIC_PENDING_QUOTED_SECOND");
  expect(quotedOutput).toContain("ordinary quoted diagnostic");
});

test("redacts structured keys separators and values split across records", () => {
  const redactor = createLogPayloadRedactor();
  const lines = [
    "{",
    '  "api_key"',
    "interleaved separator diagnostic",
    ":",
    "",
    '  "SYNTHETIC_SPLIT_SEPARATOR_SECRET",',
    '  "token"',
    ":",
    '  "SYNTHETIC_CHAINED_SEPARATOR_SECRET"',
    "}",
    "ordinary separator diagnostic",
  ];
  const output = lines.map(redactor.redactLine).join("\n");

  expect(output).not.toContain("SYNTHETIC_SPLIT_SEPARATOR_SECRET");
  expect(output).not.toContain("SYNTHETIC_CHAINED_SEPARATOR_SECRET");
  expect(output).toContain("interleaved separator diagnostic");
  expect(output).toContain("ordinary separator diagnostic");
  expect(redactLogLine(output)).toBe(output);
});

test("redacts complete console arguments and bounded stream records across writes", () => {
  const output: string[] = [];
  const originalLog = console.log;
  const originalStandardOutput: unknown = Reflect.get(process.stdout, "write");
  const originalStandardError: unknown = Reflect.get(process.stderr, "write");
  const capture = (chunk: unknown): boolean => {
    output.push(String(chunk));
    return true;
  };
  console.log = (...values: unknown[]): void => {
    output.push(format(...values));
  };
  Reflect.set(process.stdout, "write", capture);
  Reflect.set(process.stderr, "write", capture);
  const restore = installConsoleRedaction();

  try {
    console.log("--api_key", SECRET);
    process.stdout.write("OPENAI_");
    process.stdout.write("API_KEY=");
    process.stdout.write(`${SECRET}\n`);
    process.stderr.write("Proxy-Author");
    process.stderr.write("ization: Digest response=");
    process.stderr.write(`${SECRET}, nonce=synthetic\n`);
    process.stderr.write("x".repeat(65_537));
    process.stderr.write("\n");
  } finally {
    restore();
    console.log = originalLog;
    Reflect.set(process.stdout, "write", originalStandardOutput);
    Reflect.set(process.stderr, "write", originalStandardError);
  }

  const joined = output.join("\n");
  expect(joined).not.toContain(SECRET);
  expect(joined).toContain("--api_key [redacted]");
  expect(joined).toContain("OPENAI_API_KEY=[redacted]");
  expect(joined).toContain("Proxy-Authorization: Digest [redacted]");
  expect(joined).not.toContain("x".repeat(65_537));
});
