import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { Effect } from "effect";
import type { ConnectorConfig } from "../src/connector-contract";
import {
  GITHUB_MCP_ARGS,
  GITHUB_MCP_ARTIFACTS,
  GITHUB_MCP_TOOLS,
  GITHUB_MCP_VERSION,
  WINDOWS_POWERSHELL_PATH,
  assertGitHubConnectorReady,
  getGitHubConnectorArtifactStatus,
  githubMcpConnectorConfiguration,
  githubMcpExecutablePath,
  installGitHubConnectorArtifact,
  migrateLegacyGitHubConnector,
  resolvedGitHubMcpDataDir,
  trustedPowerShellPath,
  verifyGitHubMcpExecutable,
  type GitHubMcpArtifact,
} from "../src/connector-artifacts";
import { probeConnector } from "../src/connector-pool";
import { listConnectors } from "../src/connectors-service";
import { connectMcp, type McpConnection } from "../src/mcp-client";

type FixtureEntry = { name: string; bytes: Buffer; type?: number };
type ArtifactFixture = { artifact: GitHubMcpArtifact; archive: Buffer; executable: Buffer };

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function tarOctal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function tarHeader(entry: FixtureEntry): Buffer {
  const header = Buffer.alloc(512);
  header.write(entry.name, 0, 100, "utf8");
  header.write(tarOctal(0o500, 8), 100, 8, "ascii");
  header.write(tarOctal(0, 8), 108, 8, "ascii");
  header.write(tarOctal(0, 8), 116, 8, "ascii");
  header.write(tarOctal(entry.bytes.length, 12), 124, 12, "ascii");
  header.write(tarOctal(0, 12), 136, 12, "ascii");
  header.fill(32, 148, 156);
  header.writeUInt8(entry.type ?? 48, 156);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((total, value) => total + value, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function tarArchive(entries: readonly FixtureEntry[]): Buffer {
  const blocks = entries.flatMap((entry) => [
    tarHeader(entry),
    entry.bytes,
    Buffer.alloc((512 - (entry.bytes.length % 512)) % 512),
  ]);
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1_024)]));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipArchive(entries: readonly FixtureEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(crc32(entry.bytes), 14);
    localHeader.writeUInt32LE(entry.bytes.length, 18);
    localHeader.writeUInt32LE(entry.bytes.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    const localEntry = Buffer.concat([localHeader, name, entry.bytes]);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(crc32(entry.bytes), 16);
    centralHeader.writeUInt32LE(entry.bytes.length, 20);
    centralHeader.writeUInt32LE(entry.bytes.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE((0o100600 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    local.push(localEntry);
    central.push(Buffer.concat([centralHeader, name]));
    offset += localEntry.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function fixture(
  format: "tar.gz" | "zip",
  mutate?: (entries: readonly FixtureEntry[]) => readonly FixtureEntry[],
): ArtifactFixture {
  const executableName = format === "zip" ? "github-mcp-server.exe" : "github-mcp-server";
  const executable = Buffer.from("verified-github-mcp-fixture");
  const expected = [
    { name: "LICENSE", bytes: Buffer.from("license") },
    { name: "README.md", bytes: Buffer.from("readme") },
    { name: executableName, bytes: executable },
  ];
  const archive =
    format === "zip"
      ? zipArchive(mutate?.(expected) ?? expected)
      : tarArchive(mutate?.(expected) ?? expected);
  return {
    archive,
    executable,
    artifact: {
      target: `fixture-${format}`,
      platform: format === "zip" ? "win32" : "darwin",
      arch: "x64",
      version: GITHUB_MCP_VERSION,
      url: "https://fixtures.invalid/github-mcp-server",
      archiveName: format === "zip" ? "fixture.zip" : "fixture.tar.gz",
      archiveFormat: format,
      archiveSize: archive.length,
      archiveSha256: sha256(archive),
      executableName,
      executableSize: executable.length,
      executableSha256: sha256(executable),
      entries: expected.map((entry) => ({ name: entry.name, size: entry.bytes.length })),
    },
  };
}

const privateWindowsSecurity = {
  protect: async () => undefined,
  verify: async () => undefined,
};

async function temporaryDataDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "local-studio-github-mcp-"));
  await chmod(directory, 0o700);
  return realpath(directory);
}

async function installFixture(root: string, selected: ArtifactFixture) {
  return Effect.runPromise(
    installGitHubConnectorArtifact({
      artifact: selected.artifact,
      platform: selected.artifact.platform,
      arch: selected.artifact.arch,
      dataDir: root,
      fetch: async () =>
        new Response(selected.archive, {
          headers: { "Content-Length": String(selected.archive.length) },
        }),
      verifyExecutable: async () => undefined,
      ...(selected.artifact.platform === "win32"
        ? { windowsSecurity: privateWindowsSecurity }
        : {}),
    }),
  );
}

const forbiddenAmbientKeys = [
  "LOCAL_STUDIO_AMBIENT_SECRET",
  "AWS_SECRET_ACCESS_KEY",
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
];
const reviewedPosixEnvironmentKeys = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "USER",
  "LOGNAME",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "SHELL",
  "TERM",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
];
const reviewedWindowsEnvironmentKeys = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROCESSOR_ARCHITECTURE",
  "SYSTEMDRIVE",
  "USERNAME",
  "PROGRAMFILES",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
];

function exposeAmbientEnvironment(): () => void {
  const previous = new Map(forbiddenAmbientKeys.map((key) => [key, process.env[key]]));
  process.env.LOCAL_STUDIO_AMBIENT_SECRET = "ambient-secret";
  process.env.AWS_SECRET_ACCESS_KEY = "ambient-secret";
  process.env.NODE_OPTIONS = "--trace-warnings";
  process.env.LD_PRELOAD = "/ambient/loader.so";
  process.env.DYLD_INSERT_LIBRARIES = "/ambient/loader.dylib";
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function mcpFixtureSource(options: {
  token: string;
  shutdown?: "graceful" | "ignore";
  marker?: string;
}): string {
  return [
    options.marker ? 'import { writeFileSync } from "node:fs";' : "",
    `if (JSON.stringify(process.argv.slice(2)) !== ${JSON.stringify(JSON.stringify(GITHUB_MCP_ARGS))}) process.exit(41);`,
    `if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN !== ${JSON.stringify(options.token)}) process.exit(42);`,
    `if (${JSON.stringify(forbiddenAmbientKeys)}.some(key => process.env[key] !== undefined)) process.exit(43);`,
    `{ const allowed = new Set(process.platform === "win32" ? ${JSON.stringify(reviewedWindowsEnvironmentKeys)} : ${JSON.stringify(reviewedPosixEnvironmentKeys)}); if (Object.keys(process.env).some(key => !allowed.has(process.platform === "win32" ? key.toUpperCase() : key))) process.exit(44); }`,
    ...(options.shutdown === "ignore"
      ? ['process.on("SIGTERM", () => {});', "setInterval(() => {}, 1_000);"]
      : []),
    ...(options.shutdown === "graceful" && options.marker
      ? [
          `process.stdin.on("end", () => setTimeout(() => { writeFileSync(${JSON.stringify(options.marker)}, "closed"); process.exit(0); }, 75));`,
        ]
      : []),
    'let input = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", chunk => {',
    "  input += chunk;",
    "  for (;;) {",
    '    const split = input.indexOf("\\n");',
    "    if (split < 0) break;",
    "    const line = input.slice(0, split);",
    "    input = input.slice(split + 1);",
    "    if (!line) continue;",
    "    const request = JSON.parse(line);",
    '    if (request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "github-mcp-server", version: "1.6.0" } } }) + "\\n");',
    `    if (request.method === "tools/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: ${JSON.stringify(GITHUB_MCP_TOOLS.map((name) => ({ name, inputSchema: { type: "object" } })))} } }) + "\\n");`,
    "  }",
    "});",
  ]
    .filter(Boolean)
    .join("\n");
}

describe("GitHub MCP manifest and configuration", () => {
  test("pins every official Local Studio target to GitHub v1.6.0 release identity", () => {
    expect(
      Object.fromEntries(
        Object.entries(GITHUB_MCP_ARTIFACTS).map(([target, entry]) => [
          target,
          [
            entry.archiveName,
            entry.archiveSize,
            entry.archiveSha256,
            entry.executableSize,
            entry.executableSha256,
          ],
        ]),
      ),
    ).toEqual({
      "darwin-arm64": [
        "github-mcp-server_Darwin_arm64.tar.gz",
        7_644_753,
        "cdce71ef6f893d463910678ec298bba76610ca4591bf35263f0ff0ec35928f9e",
        23_627_042,
        "60e178495ae2bcb898eaffc2c21d299d553a259914430c9eaa8b3f5f76f5d129",
      ],
      "darwin-x64": [
        "github-mcp-server_Darwin_x86_64.tar.gz",
        8_122_888,
        "75bf4fb2c855a3af5381056b88afdf2e2b67e330906aadfbae9682e8dcacbd3f",
        24_877_744,
        "6a052a0a75b69fe777543039fbdeaab50e2a5262d55e43917661c558bad790d3",
      ],
      "linux-arm64": [
        "github-mcp-server_Linux_arm64.tar.gz",
        7_302_795,
        "25f8028304202674ec2e9977fec3ca0897cac33866dabb51aefd418bc0ce7ef2",
        22_937_784,
        "5d47f9e36850769db8a46c97a7ad1e7a1bd51502c57765a81e697f5740455227",
      ],
      "linux-x64": [
        "github-mcp-server_Linux_x86_64.tar.gz",
        7_957_825,
        "27443d173f209e60d4af9777e624bfea3de1af24897d46cc7324f01cf279a41d",
        24_309_944,
        "955fff9cf50ae99ee021871a4782c36360252d82fd03c8307fd7394c44ba3886",
      ],
      "win32-x64": [
        "github-mcp-server_Windows_x86_64.zip",
        8_147_960,
        "699d91a1f49897d9c51cef5794cb423401a1ab27e263c76168c133dff0d004e0",
        24_920_576,
        "66702e31cd5577e4c1437337599759256bbc23bed1bb5a76aa5f5525abc0ee1a",
      ],
    });
  });

  test("rejects filesystem roots and builds the deterministic executable path", () => {
    expect(resolvedGitHubMcpDataDir("/", "darwin")).toBeNull();
    expect(resolvedGitHubMcpDataDir("D:\\", "win32")).toBeNull();
    expect(githubMcpExecutablePath("linux", "x64", "/data")).toBe(
      "/data/runtime/connectors/github-mcp-server/1.6.0/github-mcp-server",
    );
  });

  test("ignores forged Windows roots and rejects a noncanonical PowerShell identity", () => {
    const previous = process.env.SystemRoot;
    process.env.SystemRoot = "C:\\Users\\attacker\\Windows";
    const inspected: string[] = [];
    try {
      expect(
        trustedPowerShellPath((candidate) => {
          inspected.push(candidate);
          return { file: true, symbolicLink: false, realPath: candidate };
        }),
      ).toBe(WINDOWS_POWERSHELL_PATH);
      expect(inspected).toEqual([WINDOWS_POWERSHELL_PATH]);
      expect(() =>
        trustedPowerShellPath(() => ({
          file: true,
          symbolicLink: false,
          realPath: "C:\\Users\\attacker\\powershell.exe",
        })),
      ).toThrow("Windows ACL verifier is unavailable");
    } finally {
      if (previous === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = previous;
    }
  });

  test("generates only the exact read-only execution and allowlist", () => {
    const selected = fixture("tar.gz");
    const connector = githubMcpConnectorConfiguration(
      { env: { GITHUB_PERSONAL_ACCESS_TOKEN: "token" }, enabled: true },
      { artifact: selected.artifact, platform: "darwin", arch: "x64", dataDir: "/data" },
    );
    expect(connector).toMatchObject({
      id: "github",
      name: "GitHub",
      transport: "stdio",
      args: GITHUB_MCP_ARGS,
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "token" },
      allowTools: GITHUB_MCP_TOOLS,
      origin: { kind: "catalog", id: "github", version: GITHUB_MCP_VERSION },
      enabled: true,
    });
    expect(() =>
      githubMcpConnectorConfiguration(
        { env: { PATH: "/tmp" } },
        { artifact: selected.artifact, platform: "darwin", arch: "x64", dataDir: "/data" },
      ),
    ).toThrow("environment");
  });

  test("migrates only the exact generated legacy connector and disables it for review", () => {
    const selected = fixture("tar.gz");
    const legacy: ConnectorConfig = {
      id: "github",
      name: "GitHub",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" },
      enabled: true,
    };
    const migrated = migrateLegacyGitHubConnector(legacy, {
      artifact: selected.artifact,
      platform: "darwin",
      arch: "x64",
      dataDir: "/data",
    });
    expect(migrated.migrated).toBe(true);
    expect(migrated.connector).toMatchObject({
      command: "/data/runtime/connectors/github-mcp-server/1.6.0/github-mcp-server",
      args: GITHUB_MCP_ARGS,
      env: legacy.env,
      allowTools: GITHUB_MCP_TOOLS,
      enabled: false,
    });
    for (const custom of [
      { ...legacy, name: "My GitHub" },
      { ...legacy, command: "/opt/custom/npx" },
      { ...legacy, args: [...(legacy.args ?? []), "--custom"] },
      { ...legacy, env: { ...legacy.env, GITHUB_HOST: "github.example" } },
      { ...legacy, cwd: "/tmp" },
    ]) {
      expect(migrateLegacyGitHubConnector(custom, { dataDir: "/data" })).toEqual({
        connector: custom,
        migrated: false,
      });
    }
  });

  test("persists the exact legacy migration without rewriting a custom wrapper", async () => {
    const root = await temporaryDataDir();
    const previous = process.env.LOCAL_STUDIO_DATA_DIR;
    const file = path.join(root, "connectors.json");
    const legacy: ConnectorConfig = {
      id: "github",
      name: "GitHub",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" },
      enabled: true,
    };
    const custom = { ...legacy, command: "/opt/custom/npx" };
    process.env.LOCAL_STUDIO_DATA_DIR = root;
    try {
      await writeFile(file, JSON.stringify({ connectors: [legacy] }), { mode: 0o600 });
      expect((await listConnectors())[0]).toMatchObject({
        command: githubMcpExecutablePath(process.platform, process.arch, root),
        args: GITHUB_MCP_ARGS,
        allowTools: GITHUB_MCP_TOOLS,
        enabled: false,
      });
      const persisted = JSON.parse(await readFile(file, "utf8")) as {
        connectors: ConnectorConfig[];
      };
      expect(persisted.connectors[0]?.command).not.toBe("npx");
      await writeFile(file, JSON.stringify({ connectors: [custom] }), { mode: 0o600 });
      expect(await listConnectors()).toEqual([custom]);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ connectors: [custom] });
    } finally {
      if (previous === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
      else process.env.LOCAL_STUDIO_DATA_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("GitHub MCP verified installation", () => {
  test.skipIf(process.env.LOCAL_STUDIO_GITHUB_MCP_REAL_SMOKE !== "1")(
    "installs and starts the pinned official artifact for the current platform",
    async () => {
      const root = await temporaryDataDir();
      try {
        expect(
          await Effect.runPromise(installGitHubConnectorArtifact({ dataDir: root })),
        ).toMatchObject({ version: GITHUB_MCP_VERSION, state: "installed" });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    90_000,
  );

  test("keeps status reads offline and reports unsupported targets without mutation", async () => {
    const root = await temporaryDataDir();
    const selected = fixture("tar.gz");
    try {
      expect(
        await Effect.runPromise(
          getGitHubConnectorArtifactStatus({
            artifact: selected.artifact,
            platform: "darwin",
            arch: "x64",
            dataDir: root,
          }),
        ),
      ).toEqual({
        version: GITHUB_MCP_VERSION,
        target: selected.artifact.target,
        state: "not-installed",
      });
      expect(
        await Effect.runPromise(
          getGitHubConnectorArtifactStatus({ platform: "freebsd", arch: "arm64", dataDir: root }),
        ),
      ).toEqual({ version: GITHUB_MCP_VERSION, target: "freebsd-arm64", state: "unsupported" });
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("installs bounded tar and zip fixtures atomically with private permissions", async () => {
    for (const format of ["tar.gz", "zip"] as const) {
      const root = await temporaryDataDir();
      const selected = fixture(format);
      try {
        expect((await installFixture(root, selected)).state).toBe("installed");
        const executable = path.join(
          root,
          "runtime",
          "connectors",
          "github-mcp-server",
          selected.artifact.version,
          selected.artifact.executableName,
        );
        expect(await readFile(executable)).toEqual(selected.executable);
        expect(await readdir(path.dirname(executable))).toEqual([selected.artifact.executableName]);
        if (format === "tar.gz") expect((await stat(executable)).mode & 0o777).toBe(0o500);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("rejects a Windows artifact whose owner-only ACL cannot be verified", async () => {
    const root = await temporaryDataDir();
    const selected = fixture("zip");
    try {
      await expect(
        Effect.runPromise(
          installGitHubConnectorArtifact({
            artifact: selected.artifact,
            platform: "win32",
            arch: "x64",
            dataDir: root,
            fetch: async () =>
              new Response(selected.archive, {
                headers: { "Content-Length": String(selected.archive.length) },
              }),
            verifyExecutable: async () => undefined,
            windowsSecurity: {
              protect: async () => undefined,
              verify: async (_entry, kind) => {
                if (kind === "file") throw new Error("ACL is not private");
              },
            },
          }),
        ),
      ).rejects.toThrow("installation failed");
      await expect(
        stat(path.join(root, "runtime", "connectors", "github-mcp-server", GITHUB_MCP_VERSION)),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("waits for verified MCP shutdown before Windows artifact promotion", async () => {
    const root = await temporaryDataDir();
    const selected = fixture("zip");
    let closed = false;
    let promoted = false;
    const connection: McpConnection = {
      listTools: async () =>
        GITHUB_MCP_TOOLS.map((name) => ({ name, inputSchema: { type: "object" } })),
      callTool: async () => undefined,
      close: async () => {
        await new Promise((resolve) => setTimeout(resolve, 75));
        closed = true;
      },
    };
    try {
      const status = await Effect.runPromise(
        installGitHubConnectorArtifact({
          artifact: selected.artifact,
          platform: "win32",
          arch: "x64",
          dataDir: root,
          fetch: async () =>
            new Response(selected.archive, {
              headers: { "Content-Length": String(selected.archive.length) },
            }),
          verifyExecutable: (command) =>
            Effect.runPromise(
              verifyGitHubMcpExecutable(command, {
                connect: () => connection,
                closeTimeoutMs: 1_000,
              }),
            ),
          windowsSecurity: privateWindowsSecurity,
          rename: async (source, destination) => {
            if (path.basename(source).startsWith(".pending-")) {
              expect(closed).toBe(true);
              promoted = true;
            }
            await rename(source, destination);
          },
        }),
      );
      expect(status.state).toBe("installed");
      expect(promoted).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("is idempotent without redownloading an intact artifact", async () => {
    const root = await temporaryDataDir();
    const selected = fixture("tar.gz");
    let fetches = 0;
    try {
      await installFixture(root, selected);
      const status = await Effect.runPromise(
        installGitHubConnectorArtifact({
          artifact: selected.artifact,
          platform: "darwin",
          arch: "x64",
          dataDir: root,
          fetch: async () => {
            fetches += 1;
            throw new Error("intact artifacts must not be downloaded again");
          },
          verifyExecutable: async () => undefined,
        }),
      );
      expect(status.state).toBe("installed");
      expect(fetches).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects interrupted downloads without publishing a partial target", async () => {
    const root = await temporaryDataDir();
    const selected = fixture("tar.gz");
    try {
      await expect(
        Effect.runPromise(
          installGitHubConnectorArtifact({
            artifact: selected.artifact,
            platform: "darwin",
            arch: "x64",
            dataDir: root,
            fetch: async () =>
              new Response(selected.archive.subarray(0, selected.archive.length - 1), {
                headers: { "Content-Length": String(selected.archive.length) },
              }),
            verifyExecutable: async () => undefined,
          }),
        ),
      ).rejects.toThrow("integrity");
      await expect(
        stat(path.join(root, "runtime", "connectors", "github-mcp-server", GITHUB_MCP_VERSION)),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("bounds the complete install and leaves no target after timeout", async () => {
    const root = await temporaryDataDir();
    const selected = fixture("tar.gz");
    try {
      await expect(
        Effect.runPromise(
          installGitHubConnectorArtifact({
            artifact: selected.artifact,
            platform: "darwin",
            arch: "x64",
            dataDir: root,
            timeoutMs: 25,
            fetch: async (_input, init) =>
              new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal;
                if (!signal) return;
                if (signal.aborted) reject(signal.reason);
                else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
              }),
            verifyExecutable: async () => undefined,
          }),
        ),
      ).rejects.toMatchObject({ status: 504 });
      await expect(
        stat(path.join(root, "runtime", "connectors", "github-mcp-server", GITHUB_MCP_VERSION)),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("restores the previous target when atomic promotion fails", async () => {
    const root = await temporaryDataDir();
    const selected = fixture("tar.gz");
    const target = path.join(
      root,
      "runtime",
      "connectors",
      "github-mcp-server",
      GITHUB_MCP_VERSION,
    );
    const marker = path.join(target, "previous-install");
    try {
      await mkdir(target, { recursive: true, mode: 0o700 });
      await writeFile(marker, "previous", { mode: 0o600 });
      await expect(
        Effect.runPromise(
          installGitHubConnectorArtifact({
            artifact: selected.artifact,
            platform: "darwin",
            arch: "x64",
            dataDir: root,
            fetch: async () =>
              new Response(selected.archive, {
                headers: { "Content-Length": String(selected.archive.length) },
              }),
            verifyExecutable: async () => undefined,
            rename: async (source, destination) => {
              if (path.basename(source).startsWith(".pending-") && destination === target) {
                throw new Error("promotion failed");
              }
              await rename(source, destination);
            },
          }),
        ),
      ).rejects.toThrow("installation failed");
      expect(await readFile(marker, "utf8")).toBe("previous");
      expect(await readdir(target)).toEqual(["previous-install"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fails closed on checksum mismatch, traversal, symlinks, and oversized archives", async () => {
    const oversizedFixture = fixture("tar.gz");
    const oversizedArchive = Buffer.alloc(12 * 1024 * 1024 + 1);
    for (const selected of [
      {
        ...fixture("tar.gz"),
        artifact: { ...fixture("tar.gz").artifact, archiveSha256: "0".repeat(64) },
      },
      fixture("tar.gz", (entries) => [
        ...entries,
        { name: "../escape", bytes: Buffer.from("escape") },
      ]),
      fixture("tar.gz", (entries) => [
        ...entries,
        { name: "github-mcp-link", bytes: Buffer.alloc(0), type: 50 },
      ]),
      {
        ...oversizedFixture,
        archive: oversizedArchive,
        artifact: {
          ...oversizedFixture.artifact,
          archiveSize: oversizedArchive.length,
          archiveSha256: sha256(oversizedArchive),
        },
      },
    ]) {
      const root = await temporaryDataDir();
      try {
        await expect(installFixture(root, selected)).rejects.toThrow();
        const target = path.join(
          root,
          "runtime",
          "connectors",
          "github-mcp-server",
          GITHUB_MCP_VERSION,
        );
        await expect(stat(target)).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("verifies immutable state before every managed spawn", async () => {
    const root = await temporaryDataDir();
    const selected = fixture("tar.gz");
    try {
      await installFixture(root, selected);
      const dependencies = {
        artifact: selected.artifact,
        platform: "darwin" as const,
        arch: "x64",
        dataDir: root,
      };
      const connector = githubMcpConnectorConfiguration(
        { env: { GITHUB_PERSONAL_ACCESS_TOKEN: "token" }, enabled: true },
        dependencies,
      );
      await Effect.runPromise(assertGitHubConnectorReady(connector, dependencies));
      if (!connector.command) throw new Error("fixture executable path unavailable");
      await chmod(connector.command, 0o700);
      await writeFile(connector.command, "tampered");
      expect(await Effect.runPromise(getGitHubConnectorArtifactStatus(dependencies))).toMatchObject(
        { state: "invalid" },
      );
      await expect(
        Effect.runPromise(assertGitHubConnectorReady(connector, dependencies)),
      ).rejects.toThrow("integrity");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("blocks a managed probe before spawn when the verified artifact is absent", async () => {
    const root = await temporaryDataDir();
    const previous = process.env.LOCAL_STUDIO_DATA_DIR;
    process.env.LOCAL_STUDIO_DATA_DIR = root;
    try {
      const connector = githubMcpConnectorConfiguration({
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "token" },
        enabled: true,
      });
      expect(await probeConnector(connector)).toMatchObject({
        ok: false,
        tools: [],
        error: "GitHub MCP integrity check failed",
      });
    } finally {
      if (previous === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
      else process.env.LOCAL_STUDIO_DATA_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("smoke-tests the exact read-only argv and 22-tool inventory", async () => {
    const root = await temporaryDataDir();
    const server = path.join(root, "fixture-server.mjs");
    const restore = exposeAmbientEnvironment();
    try {
      await writeFile(
        server,
        mcpFixtureSource({ token: "local-studio-install-verification" }),
        { mode: 0o600 },
      );
      await Effect.runPromise(
        verifyGitHubMcpExecutable(process.execPath, { prefixArgs: [server], timeoutMs: 5_000 }),
      );
    } finally {
      restore();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps managed runtime spawns to the PAT and reviewed OS environment", async () => {
    const root = await temporaryDataDir();
    const server = path.join(root, "managed-server.mjs");
    const restore = exposeAmbientEnvironment();
    let connection: McpConnection | null = null;
    try {
      await writeFile(server, mcpFixtureSource({ token: "managed-token" }), { mode: 0o600 });
      const connector = githubMcpConnectorConfiguration(
        { env: { GITHUB_PERSONAL_ACCESS_TOKEN: "managed-token" }, enabled: true },
        { artifact: fixture("tar.gz").artifact, platform: "darwin", arch: "x64", dataDir: root },
      );
      connection = connectMcp({
        transport: "stdio",
        command: process.execPath,
        args: [server, ...(connector.args ?? [])],
        env: connector.env,
      });
      expect((await connection.listTools()).map((tool) => tool.name).sort()).toEqual(
        [...GITHUB_MCP_TOOLS].sort(),
      );
      await connection.close();
      connection = null;
    } finally {
      await connection?.close().catch(() => undefined);
      restore();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("waits for a slow graceful MCP child exit", async () => {
    const root = await temporaryDataDir();
    const server = path.join(root, "slow-server.mjs");
    const marker = path.join(root, "closed");
    const restore = exposeAmbientEnvironment();
    let connection: McpConnection | null = null;
    try {
      await writeFile(
        server,
        mcpFixtureSource({ token: "slow-token", shutdown: "graceful", marker }),
        { mode: 0o600 },
      );
      connection = connectMcp(
        {
          transport: "stdio",
          command: process.execPath,
          args: [server, ...GITHUB_MCP_ARGS],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: "slow-token" },
        },
        { gracefulCloseMs: 1_000, forceCloseMs: 1_000 },
      );
      await connection.listTools();
      await connection.close();
      connection = null;
      expect(await readFile(marker, "utf8")).toBe("closed");
    } finally {
      await connection?.close().catch(() => undefined);
      restore();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("force-terminates an MCP child that ignores graceful shutdown", async () => {
    const root = await temporaryDataDir();
    const server = path.join(root, "ignoring-server.mjs");
    const restore = exposeAmbientEnvironment();
    let connection: McpConnection | null = null;
    try {
      await writeFile(
        server,
        mcpFixtureSource({ token: "ignoring-token", shutdown: "ignore" }),
        { mode: 0o600 },
      );
      connection = connectMcp(
        {
          transport: "stdio",
          command: process.execPath,
          args: [server, ...GITHUB_MCP_ARGS],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ignoring-token" },
        },
        { gracefulCloseMs: 50, forceCloseMs: 1_000 },
      );
      await connection.listTools();
      const started = Date.now();
      await connection.close();
      connection = null;
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      await connection?.close().catch(() => undefined);
      restore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
