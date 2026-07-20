import { describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { ToolSchema } from "../../../frontend/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js";
import { Effect } from "../../../frontend/node_modules/effect/dist/index.js";
import { NextRequest } from "../../../frontend/node_modules/next/server";
import {
  GITHUB_MCP_ARGS,
  GITHUB_MCP_ARTIFACTS,
  GITHUB_MCP_INVENTORY_DIGEST,
  GITHUB_MCP_TOOLS,
  GITHUB_MCP_VERSION,
  getGitHubConnectorArtifactStatus,
  githubMcpArtifactFor,
  githubMcpExecutablePath,
  installGitHubConnectorArtifact,
  resolvedGitHubMcpDataDir,
  verifyGitHubMcpExecutable,
  type GitHubMcpArtifact,
} from "../../../services/agent-runtime/src/connector-artifacts";
import { connectorInventoryDigest } from "../../../services/agent-runtime/src/connector-inventory";
import { probeConnector } from "../../../services/agent-runtime/src/connector-pool";
import {
  catalogConnectorConfiguration,
  catalogConnectorRuntime,
  connectorToolRisk,
} from "../../../services/agent-runtime/src/connector-policy";
import {
  GET as getGitHubArtifactHttp,
  POST as installGitHubArtifactHttp,
} from "../../../frontend/src/app/api/agent/connectors/github/route";

type FixtureEntry = { name: string; bytes: Buffer };
type ArtifactFixture = { artifact: GitHubMcpArtifact; archive: Buffer; executable: Buffer };

const expectedTools = [
  "get_commit",
  "get_file_contents",
  "get_label",
  "get_latest_release",
  "get_release_by_tag",
  "get_tag",
  "issue_read",
  "list_branches",
  "list_commits",
  "list_issue_fields",
  "list_issue_types",
  "list_issues",
  "list_pull_requests",
  "list_releases",
  "list_repository_collaborators",
  "list_tags",
  "pull_request_read",
  "search_code",
  "search_commits",
  "search_issues",
  "search_pull_requests",
  "search_repositories",
] as const;

const officialInventoryPath = path.join(
  import.meta.dir,
  "../fixtures/github-mcp-v1.6.0-tools.json",
);

async function officialGitHubMcpTools() {
  const decoded: unknown = JSON.parse(await readFile(officialInventoryPath, "utf8"));
  const parsed = ToolSchema.array().safeParse(decoded);
  if (!parsed.success) throw new Error("Official GitHub MCP inventory fixture is invalid");
  return parsed.data;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

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
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((total, value) => total + value, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function tarArchive(entries: readonly FixtureEntry[]): Buffer {
  const blocks = entries.flatMap((entry) => {
    const padding = Buffer.alloc((512 - (entry.bytes.length % 512)) % 512);
    return [tarHeader(entry), entry.bytes, padding];
  });
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

function zipLocalHeader(entry: FixtureEntry): Buffer {
  const name = Buffer.from(entry.name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt32LE(crc32(entry.bytes), 14);
  header.writeUInt32LE(entry.bytes.length, 18);
  header.writeUInt32LE(entry.bytes.length, 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, entry.bytes]);
}

function zipCentralHeader(entry: FixtureEntry, offset: number): Buffer {
  const name = Buffer.from(entry.name);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt32LE(crc32(entry.bytes), 16);
  header.writeUInt32LE(entry.bytes.length, 20);
  header.writeUInt32LE(entry.bytes.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE((0o100600 << 16) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

function zipEnd(entries: number, centralSize: number, centralOffset: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries, 8);
  end.writeUInt16LE(entries, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return end;
}

function zipArchive(entries: readonly FixtureEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const localEntry = zipLocalHeader(entry);
    local.push(localEntry);
    central.push(zipCentralHeader(entry, offset));
    offset += localEntry.length;
  }
  const centralBytes = Buffer.concat(central);
  return Buffer.concat([
    ...local,
    centralBytes,
    zipEnd(entries.length, centralBytes.length, offset),
  ]);
}

function artifactFixture(
  format: "tar.gz" | "zip",
  archiveEntries?: (entries: readonly FixtureEntry[]) => readonly FixtureEntry[],
): ArtifactFixture {
  const executableName = format === "zip" ? "github-mcp-server.exe" : "github-mcp-server";
  const executable = Buffer.from("fixture-github-mcp-executable");
  const entries = [
    { name: "LICENSE", bytes: Buffer.from("license") },
    { name: "README.md", bytes: Buffer.from("readme") },
    { name: executableName, bytes: executable },
  ];
  const packedEntries = archiveEntries?.(entries) ?? entries;
  const archive = format === "zip" ? zipArchive(packedEntries) : tarArchive(packedEntries);
  return {
    executable,
    archive,
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
      entries: entries.map((entry) => ({ name: entry.name, size: entry.bytes.length })),
    },
  };
}

async function temporaryDataDir(): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), "local-studio-github-artifact-")));
}

function archiveResponse(archive: Buffer): Response {
  return new Response(archive, { headers: { "Content-Length": String(archive.length) } });
}

async function installFixture(
  root: string,
  fixture: ArtifactFixture,
  overrides: Partial<Parameters<typeof installGitHubConnectorArtifact>[0]> = {},
) {
  return Effect.runPromise(
    installGitHubConnectorArtifact({
      artifact: fixture.artifact,
      platform: fixture.artifact.platform,
      arch: fixture.artifact.arch,
      dataDir: root,
      fetch: async () => archiveResponse(fixture.archive),
      verifyExecutable: async () => undefined,
      ...(fixture.artifact.platform === "win32"
        ? {
            windowsSecurity: {
              protect: async () => undefined,
              verify: async () => undefined,
            },
          }
        : {}),
      ...overrides,
    }),
  );
}

function installedRoot(root: string, artifact: GitHubMcpArtifact): string {
  return path.join(root, "runtime", "connectors", "github-mcp-server", artifact.version);
}

async function createDeadInstallLock(
  root: string,
  artifact: GitHubMcpArtifact,
): Promise<{ base: string; claim: string }> {
  const base = path.dirname(installedRoot(root, artifact));
  const claimName = `.install-${randomUUID()}.claim`;
  const claim = path.join(base, claimName);
  await mkdir(base, { recursive: true, mode: 0o700 });
  await writeFile(claim, JSON.stringify({ version: 1, pid: 2_147_483_647, claim: claimName }), {
    mode: 0o600,
  });
  await chmod(claim, 0o600);
  await link(claim, path.join(base, ".install.lock"));
  return { base, claim };
}

async function waitForFile(entry: string): Promise<void> {
  await Effect.runPromise(
    Effect.gen(function* () {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (existsSync(entry)) return;
        yield* Effect.sleep(10);
      }
      return yield* Effect.fail(new Error(`Timed out waiting for ${path.basename(entry)}`));
    }),
  );
}

async function processError(child: ReturnType<typeof Bun.spawn>): Promise<string> {
  return child.stderr ? new Response(child.stderr).text() : "";
}

describe("GitHub MCP artifact manifest", () => {
  test("pins the exact official v1.6.0 artifacts for every supported Local Studio tuple", () => {
    expect(
      Object.fromEntries(
        Object.entries(GITHUB_MCP_ARTIFACTS).map(([target, entry]) => [
          target,
          {
            url: entry.url,
            archiveSize: entry.archiveSize,
            archiveSha256: entry.archiveSha256,
            executableSize: entry.executableSize,
            executableSha256: entry.executableSha256,
          },
        ]),
      ),
    ).toEqual({
      "darwin-arm64": {
        url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Darwin_arm64.tar.gz",
        archiveSize: 7_644_753,
        archiveSha256: "cdce71ef6f893d463910678ec298bba76610ca4591bf35263f0ff0ec35928f9e",
        executableSize: 23_627_042,
        executableSha256: "60e178495ae2bcb898eaffc2c21d299d553a259914430c9eaa8b3f5f76f5d129",
      },
      "darwin-x64": {
        url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Darwin_x86_64.tar.gz",
        archiveSize: 8_122_888,
        archiveSha256: "75bf4fb2c855a3af5381056b88afdf2e2b67e330906aadfbae9682e8dcacbd3f",
        executableSize: 24_877_744,
        executableSha256: "6a052a0a75b69fe777543039fbdeaab50e2a5262d55e43917661c558bad790d3",
      },
      "linux-arm64": {
        url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Linux_arm64.tar.gz",
        archiveSize: 7_302_795,
        archiveSha256: "25f8028304202674ec2e9977fec3ca0897cac33866dabb51aefd418bc0ce7ef2",
        executableSize: 22_937_784,
        executableSha256: "5d47f9e36850769db8a46c97a7ad1e7a1bd51502c57765a81e697f5740455227",
      },
      "linux-x64": {
        url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Linux_x86_64.tar.gz",
        archiveSize: 7_957_825,
        archiveSha256: "27443d173f209e60d4af9777e624bfea3de1af24897d46cc7324f01cf279a41d",
        executableSize: 24_309_944,
        executableSha256: "955fff9cf50ae99ee021871a4782c36360252d82fd03c8307fd7394c44ba3886",
      },
      "win32-x64": {
        url: "https://github.com/github/github-mcp-server/releases/download/v1.6.0/github-mcp-server_Windows_x86_64.zip",
        archiveSize: 8_147_960,
        archiveSha256: "699d91a1f49897d9c51cef5794cb423401a1ab27e263c76168c133dff0d004e0",
        executableSize: 24_920_576,
        executableSha256: "66702e31cd5577e4c1437337599759256bbc23bed1bb5a76aa5f5525abc0ee1a",
      },
    });
    expect(Object.keys(GITHUB_MCP_ARTIFACTS)).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "win32-x64",
    ]);
  });

  test("accepts shallow data directories while rejecting filesystem roots", () => {
    expect(resolvedGitHubMcpDataDir("/data", "linux")).toBe("/data");
    expect(githubMcpExecutablePath("linux", "x64", "/data")).toBe(
      "/data/runtime/connectors/github-mcp-server/1.6.0/github-mcp-server",
    );
    expect(resolvedGitHubMcpDataDir("/", "darwin")).toBeNull();
    expect(resolvedGitHubMcpDataDir("D:\\LocalStudioData", "win32")).toBe("D:\\LocalStudioData");
    expect(githubMcpExecutablePath("win32", "x64", "D:\\LocalStudioData")).toBe(
      "D:\\LocalStudioData\\runtime\\connectors\\github-mcp-server\\1.6.0\\github-mcp-server.exe",
    );
    expect(resolvedGitHubMcpDataDir("D:\\", "win32")).toBeNull();
  });

  test("binds the generated connector to exact argv, token environment, and 22 read tools", async () => {
    const root = await temporaryDataDir();
    const previous = process.env.LOCAL_STUDIO_DATA_DIR;
    process.env.LOCAL_STUDIO_DATA_DIR = root;
    try {
      const selected = githubMcpArtifactFor();
      if (!selected) throw new Error("Test platform is unsupported");
      const configured = catalogConnectorConfiguration({
        id: "github",
        catalogId: "github",
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "token" },
        allowTools: expectedTools,
        permissionReviewed: true,
        enabled: true,
      });
      expect(GITHUB_MCP_ARGS).toEqual([
        "stdio",
        "--read-only",
        "--toolsets=repos,issues,pull_requests",
      ]);
      expect(GITHUB_MCP_TOOLS).toEqual(expectedTools);
      expect(GITHUB_MCP_INVENTORY_DIGEST).toBe(
        "sha256:c1cf11fc3b7cdf3afd1301bf38bc6c8a9bbd5357ca50baa2ec175ac89c144772",
      );
      expect(configured.command).toBe(githubMcpExecutablePath());
      expect(configured.args).toEqual(GITHUB_MCP_ARGS);
      expect(configured.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: "token" });
      expect(configured.origin).toMatchObject({
        artifactDigest: `sha256:${selected.executableSha256}`,
        inventoryDigest: GITHUB_MCP_INVENTORY_DIGEST,
      });
      expect(expectedTools.every((tool) => connectorToolRisk(configured, tool) === "read")).toBe(
        true,
      );
      expect(connectorToolRisk(configured, "create_issue")).toBe("critical");
      expect(await catalogConnectorRuntime(configured)).toBeNull();
      expect(await readdir(root)).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
      else process.env.LOCAL_STUDIO_DATA_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses a tampered deterministic command before spawning it", async () => {
    if (process.platform === "win32") return;
    const root = await temporaryDataDir();
    const previous = process.env.LOCAL_STUDIO_DATA_DIR;
    process.env.LOCAL_STUDIO_DATA_DIR = root;
    const marker = path.join(root, "spawned");
    try {
      const configured = catalogConnectorConfiguration({
        id: "github",
        catalogId: "github",
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "token" },
        allowTools: expectedTools,
        permissionReviewed: true,
        enabled: true,
      });
      if (!configured.command) throw new Error("GitHub command is unavailable");
      await mkdir(path.dirname(configured.command), { recursive: true, mode: 0o700 });
      for (
        let directory = path.dirname(configured.command);
        directory.startsWith(root) && directory !== root;
        directory = path.dirname(directory)
      ) {
        await chmod(directory, 0o700);
      }
      await writeFile(configured.command, `#!/bin/sh\n/usr/bin/touch '${marker}'\n`, {
        mode: 0o500,
      });
      expect((await probeConnector(configured)).ok).toBe(false);
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
      else process.env.LOCAL_STUDIO_DATA_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("GitHub MCP artifact installation", () => {
  const officialArchive = process.env.LOCAL_STUDIO_TEST_GITHUB_MCP_ARCHIVE;

  test.skipIf(
    !officialArchive || process.platform !== "darwin" || process.arch !== "arm64",
  )("installs and verifies the exact official Darwin arm64 release", async () => {
    if (!officialArchive) throw new Error("Official GitHub MCP archive is unavailable");
    const archive = await readFile(officialArchive);
    const root = await temporaryDataDir();
    try {
      const status = await Effect.runPromise(
        installGitHubConnectorArtifact({
          platform: "darwin",
          arch: "arm64",
          dataDir: root,
          fetch: async () =>
            new Response(archive, {
              headers: { "Content-Length": String(archive.length) },
            }),
        }),
      );
      expect(status).toMatchObject({ state: "installed", target: "darwin-arm64" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps missing and unsupported status reads non-mutating and offline", async () => {
    const root = await temporaryDataDir();
    let fetches = 0;
    try {
      const fixture = artifactFixture("tar.gz");
      expect(
        await Effect.runPromise(
          getGitHubConnectorArtifactStatus({
            artifact: fixture.artifact,
            platform: fixture.artifact.platform,
            dataDir: root,
          }),
        ),
      ).toEqual({
        version: GITHUB_MCP_VERSION,
        target: fixture.artifact.target,
        state: "not-installed",
      });
      expect(await readdir(root)).toEqual([]);
      expect(
        await Effect.runPromise(
          getGitHubConnectorArtifactStatus({ platform: "freebsd", arch: "arm64", dataDir: root }),
        ),
      ).toEqual({
        version: GITHUB_MCP_VERSION,
        target: "freebsd-arm64",
        state: "unsupported",
      });
      await expect(
        Effect.runPromise(
          installGitHubConnectorArtifact({
            platform: "freebsd",
            arch: "arm64",
            dataDir: root,
            fetch: async () => {
              fetches += 1;
              return new Response();
            },
          }),
        ),
      ).rejects.toThrow("unavailable");
      expect(fetches).toBe(0);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("installs bounded tar and zip fixtures into one immutable executable", async () => {
    for (const format of ["tar.gz", "zip"] as const) {
      const root = await temporaryDataDir();
      const fixture = artifactFixture(format);
      try {
        expect((await installFixture(root, fixture)).state).toBe("installed");
        const target = installedRoot(root, fixture.artifact);
        expect(await readdir(target)).toEqual([fixture.artifact.executableName]);
        expect(await readFile(path.join(target, fixture.artifact.executableName))).toEqual(
          fixture.executable,
        );
        if (fixture.artifact.platform !== "win32") {
          expect(
            (await stat(path.join(target, fixture.artifact.executableName))).mode & 0o777,
          ).toBe(0o500);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("protects Windows directories and executable with verified owner-only ACLs", async () => {
    const root = await temporaryDataDir();
    const fixture = artifactFixture("zip");
    const protectedEntries: string[] = [];
    const verifiedEntries: string[] = [];
    try {
      await installFixture(root, fixture, {
        windowsSecurity: {
          protect: async (entry, kind, access) => {
            protectedEntries.push(`${kind}:${access}:${entry}`);
          },
          verify: async (entry, kind, access) => {
            verifiedEntries.push(`${kind}:${access}:${entry}`);
          },
        },
      });
      expect(protectedEntries.every((entry) => verifiedEntries.includes(entry))).toBe(true);
      expect(
        protectedEntries.some(
          (entry) =>
            entry.startsWith("file:private:") && entry.endsWith(fixture.artifact.executableName),
        ),
      ).toBe(true);
      expect(
        protectedEntries.filter((entry) => entry.startsWith("directory:private:")),
      ).toHaveLength(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a Windows executable whose owner-only ACL cannot be verified", async () => {
    const root = await temporaryDataDir();
    const fixture = artifactFixture("zip");
    try {
      await expect(
        installFixture(root, fixture, {
          windowsSecurity: {
            protect: async () => undefined,
            verify: async (entry, kind) => {
              if (kind === "file") throw new Error(`permissive ACL: ${entry}`);
            },
          },
        }),
      ).rejects.toThrow("installation failed");
      expect(existsSync(installedRoot(root, fixture.artifact))).toBe(false);
      expect(await readdir(path.dirname(installedRoot(root, fixture.artifact)))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("returns an already verified installation without downloading again", async () => {
    const root = await temporaryDataDir();
    const fixture = artifactFixture("tar.gz");
    try {
      await installFixture(root, fixture);
      const status = await installFixture(root, fixture, {
        fetch: async () => {
          throw new Error("unexpected download");
        },
      });
      expect(status.state).toBe("installed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serializes installation across processes", async () => {
    const root = await temporaryDataDir();
    const fixture = artifactFixture(process.platform === "win32" ? "zip" : "tar.gz");
    const worker = path.join(root, "installer.ts");
    const archive = path.join(root, fixture.artifact.archiveName);
    const manifest = path.join(root, "artifact.json");
    const fetches = path.join(root, "fetches");
    const release = path.join(root, "release");
    const source = [
      `import { Effect } from ${JSON.stringify(path.resolve("frontend/node_modules/effect/dist/index.js"))}`,
      `import { installGitHubConnectorArtifact } from ${JSON.stringify(path.resolve("services/agent-runtime/src/connector-artifacts.ts"))}`,
      "import { appendFile, readFile, writeFile } from 'node:fs/promises'",
      "import path from 'node:path'",
      "const [dataDir, archivePath, manifestPath, fetchPath, releasePath, id] = process.argv.slice(2)",
      "const archive = await readFile(archivePath)",
      "const artifact = JSON.parse(await readFile(manifestPath, 'utf8'))",
      "await writeFile(path.join(dataDir, `started-${id}`), '')",
      "await Effect.runPromise(installGitHubConnectorArtifact({",
      "artifact, platform: artifact.platform, arch: artifact.arch, dataDir, timeoutMs: 5000,",
      "fetch: async () => { await appendFile(fetchPath, '1'); return new Response(archive, { headers: { 'Content-Length': String(archive.length) } }) },",
      "verifyExecutable: async () => {",
      "await writeFile(path.join(dataDir, `entered-${id}`), '')",
      "while (true) { try { await readFile(releasePath); break } catch { await Effect.runPromise(Effect.sleep(10)) } }",
      "},",
      "...(artifact.platform === 'win32' ? { windowsSecurity: { protect: async () => undefined, verify: async () => undefined } } : {}),",
      "}))",
    ].join("\n");
    await writeFile(worker, source);
    await writeFile(archive, fixture.archive);
    await writeFile(manifest, JSON.stringify(fixture.artifact));
    const spawn = (id: string) =>
      Bun.spawn([process.execPath, worker, root, archive, manifest, fetches, release, id], {
        stdout: "pipe",
        stderr: "pipe",
      });
    const first = spawn("first");
    let second: ReturnType<typeof Bun.spawn> | null = null;
    let observedFetches = "";
    try {
      await waitForFile(path.join(root, "entered-first"));
      second = spawn("second");
      await waitForFile(path.join(root, "started-second"));
      await Effect.runPromise(Effect.sleep(500));
      observedFetches = await readFile(fetches, "utf8");
    } finally {
      await writeFile(release, "");
    }
    if (!second) throw new Error("Second installer did not start");
    const [firstExit, secondExit, firstError, secondError] = await Promise.all([
      first.exited,
      second.exited,
      processError(first),
      processError(second),
    ]);
    try {
      expect(observedFetches).toBe("1");
      expect([firstExit, secondExit]).toEqual([0, 0]);
      expect([firstError, secondError]).toEqual(["", ""]);
      expect(await readdir(path.join(root, "runtime", "connectors", "github-mcp-server"))).toEqual([
        fixture.artifact.version,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reclaims a dead process lock without leaving lock artifacts", async () => {
    const root = await temporaryDataDir();
    const fixture = artifactFixture(process.platform === "win32" ? "zip" : "tar.gz");
    try {
      const { base } = await createDeadInstallLock(root, fixture.artifact);
      expect((await installFixture(root, fixture)).state).toBe("installed");
      expect(await readdir(base)).toEqual([fixture.artifact.version]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("recovers interrupted stale lock cleanup states", async () => {
    const fixture = artifactFixture(process.platform === "win32" ? "zip" : "tar.gz");
    for (const state of ["missing-claim", "reaping"] as const) {
      const root = await temporaryDataDir();
      try {
        const { base, claim } = await createDeadInstallLock(root, fixture.artifact);
        if (state === "missing-claim") await unlink(claim);
        else await rename(claim, `${claim}.reaping`);
        expect((await installFixture(root, fixture)).state).toBe("installed");
        expect(await readdir(base)).toEqual([fixture.artifact.version]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("serializes concurrent stale lock recovery", async () => {
    const root = await temporaryDataDir();
    const fixture = artifactFixture(process.platform === "win32" ? "zip" : "tar.gz");
    const worker = path.join(root, "stale-installer.ts");
    const archive = path.join(root, fixture.artifact.archiveName);
    const manifest = path.join(root, "artifact.json");
    const fetches = path.join(root, "fetches");
    const source = [
      `import { Effect } from ${JSON.stringify(path.resolve("frontend/node_modules/effect/dist/index.js"))}`,
      `import { installGitHubConnectorArtifact } from ${JSON.stringify(path.resolve("services/agent-runtime/src/connector-artifacts.ts"))}`,
      "import { appendFile, readFile } from 'node:fs/promises'",
      "const [dataDir, archivePath, manifestPath, fetchPath] = process.argv.slice(2)",
      "const archive = await readFile(archivePath)",
      "const artifact = JSON.parse(await readFile(manifestPath, 'utf8'))",
      "await Effect.runPromise(installGitHubConnectorArtifact({",
      "artifact, platform: artifact.platform, arch: artifact.arch, dataDir, timeoutMs: 5000,",
      "fetch: async () => { await appendFile(fetchPath, '1'); return new Response(archive, { headers: { 'Content-Length': String(archive.length) } }) },",
      "verifyExecutable: async () => undefined,",
      "...(artifact.platform === 'win32' ? { windowsSecurity: { protect: async () => undefined, verify: async () => undefined } } : {}),",
      "}))",
    ].join("\n");
    try {
      const { base } = await createDeadInstallLock(root, fixture.artifact);
      await writeFile(worker, source);
      await writeFile(archive, fixture.archive);
      await writeFile(manifest, JSON.stringify(fixture.artifact));
      const children = Array.from({ length: 4 }, () =>
        Bun.spawn([process.execPath, worker, root, archive, manifest, fetches], {
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const results = await Promise.all(
        children.map(async (child) => ({
          exit: await child.exited,
          error: await processError(child),
        })),
      );
      expect(results).toEqual(Array.from({ length: 4 }, () => ({ exit: 0, error: "" })));
      expect(await readFile(fetches, "utf8")).toBe("1");
      expect(await readdir(base)).toEqual([fixture.artifact.version]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a symlinked process lock without altering its target", async () => {
    if (process.platform === "win32") return;
    const root = await temporaryDataDir();
    const external = await temporaryDataDir();
    const fixture = artifactFixture("tar.gz");
    const base = path.dirname(installedRoot(root, fixture.artifact));
    const sentinel = path.join(external, "sentinel");
    try {
      await mkdir(base, { recursive: true, mode: 0o700 });
      await writeFile(sentinel, "preserved", { mode: 0o600 });
      await symlink(sentinel, path.join(base, ".install.lock"));
      await expect(installFixture(root, fixture)).rejects.toThrow("install lock is unsafe");
      expect(await readFile(sentinel, "utf8")).toBe("preserved");
      expect(existsSync(installedRoot(root, fixture.artifact))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });

  test("reports executable tampering as invalid and repairs only after an explicit install", async () => {
    const root = await temporaryDataDir();
    const fixture = artifactFixture("tar.gz");
    const executable = path.join(
      installedRoot(root, fixture.artifact),
      fixture.artifact.executableName,
    );
    let fetches = 0;
    try {
      await installFixture(root, fixture);
      await chmod(executable, 0o700);
      await writeFile(executable, "tampered");
      await chmod(executable, 0o500);
      expect(
        (
          await Effect.runPromise(
            getGitHubConnectorArtifactStatus({
              artifact: fixture.artifact,
              platform: fixture.artifact.platform,
              dataDir: root,
            }),
          )
        ).state,
      ).toBe("invalid");
      expect(fetches).toBe(0);
      expect(
        (
          await installFixture(root, fixture, {
            fetch: async () => {
              fetches += 1;
              return archiveResponse(fixture.archive);
            },
          })
        ).state,
      ).toBe("installed");
      expect(fetches).toBe(1);
      expect(await readFile(executable)).toEqual(fixture.executable);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a permission-only executable mutation", async () => {
    if (process.platform === "win32") return;
    const root = await temporaryDataDir();
    const fixture = artifactFixture("tar.gz");
    const executable = path.join(
      installedRoot(root, fixture.artifact),
      fixture.artifact.executableName,
    );
    try {
      await installFixture(root, fixture);
      await chmod(executable, 0o700);
      expect(
        (
          await Effect.runPromise(
            getGitHubConnectorArtifactStatus({
              artifact: fixture.artifact,
              platform: fixture.artifact.platform,
              dataDir: root,
            }),
          )
        ).state,
      ).toBe("invalid");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects checksum mismatch, traversal, oversize, and interrupted streams without a target", async () => {
    const cases: Array<{
      name: string;
      fixture: ArtifactFixture;
      overrides?: Partial<Parameters<typeof installGitHubConnectorArtifact>[0]>;
    }> = [];
    const checksum = artifactFixture("tar.gz");
    cases.push({
      name: "checksum",
      fixture: {
        ...checksum,
        artifact: { ...checksum.artifact, archiveSha256: "0".repeat(64) },
      },
    });
    const traversal = artifactFixture("tar.gz", (entries) => [
      { name: "../escape", bytes: Buffer.from("escape") },
      ...entries,
    ]);
    cases.push({ name: "traversal", fixture: traversal });
    const oversized = artifactFixture("tar.gz");
    const oversizedArchive = Buffer.alloc(12 * 1024 * 1024 + 1);
    cases.push({
      name: "oversize",
      fixture: {
        ...oversized,
        archive: oversizedArchive,
        artifact: {
          ...oversized.artifact,
          archiveSize: oversizedArchive.length,
          archiveSha256: sha256(oversizedArchive),
        },
      },
    });
    const interrupted = artifactFixture("tar.gz");
    cases.push({
      name: "interrupted",
      fixture: interrupted,
      overrides: {
        fetch: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(interrupted.archive.subarray(0, 32));
                controller.error(new Error("interrupted"));
              },
            }),
            { headers: { "Content-Length": String(interrupted.archive.length) } },
          ),
      },
    });
    const timedOut = artifactFixture("tar.gz");
    cases.push({
      name: "timeout",
      fixture: timedOut,
      overrides: {
        timeoutMs: 5,
        verifyExecutable: () => new Promise((resolve) => setTimeout(resolve, 15)),
      },
    });
    for (const entry of cases) {
      const root = await temporaryDataDir();
      try {
        await expect(installFixture(root, entry.fixture, entry.overrides)).rejects.toThrow();
        expect(existsSync(installedRoot(root, entry.fixture.artifact))).toBe(false);
        const base = path.dirname(installedRoot(root, entry.fixture.artifact));
        expect(existsSync(base) ? await readdir(base) : []).toEqual([]);
        expect(existsSync(path.join(root, "escape"))).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("restores the prior target when atomic promotion fails", async () => {
    const root = await temporaryDataDir();
    const fixture = artifactFixture("tar.gz");
    const target = installedRoot(root, fixture.artifact);
    const executable = path.join(target, fixture.artifact.executableName);
    const previous = Buffer.from("prior-installation");
    let renames = 0;
    try {
      await mkdir(target, { recursive: true, mode: 0o700 });
      await writeFile(executable, previous, { mode: 0o500 });
      await chmod(executable, 0o500);
      await expect(
        installFixture(root, fixture, {
          rename: async (source, destination) => {
            renames += 1;
            if (renames === 2) throw new Error("promotion failed");
            await rename(source, destination);
          },
        }),
      ).rejects.toThrow("installation failed");
      expect(await readFile(executable)).toEqual(previous);
      expect(await readdir(path.dirname(target))).toEqual([fixture.artifact.version]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("GitHub MCP startup verification", () => {
  test("binds the expected digest to the canonical official v1.6.0 inventory", async () => {
    const tools = await officialGitHubMcpTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...expectedTools].sort());
    expect(connectorInventoryDigest(tools)).toBe(GITHUB_MCP_INVENTORY_DIGEST);
  });

  test("starts with exact read-only argv, isolates ambient secrets, and verifies tool inventory", async () => {
    const tools = await officialGitHubMcpTools();
    const source = [
      `const expectedArgs = ${JSON.stringify(GITHUB_MCP_ARGS)}`,
      `const tools = ${JSON.stringify(tools)}`,
      "if (JSON.stringify(process.argv.slice(1)) !== JSON.stringify(expectedArgs)) process.exit(2)",
      "if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN !== 'local-studio-install-verification') process.exit(3)",
      "if (process.env.LOCAL_STUDIO_TEST_AMBIENT_SECRET) process.exit(4)",
      "const readline = require('node:readline')",
      "const lines = readline.createInterface({ input: process.stdin })",
      "lines.on('line', (line) => {",
      "const message = JSON.parse(line)",
      "if (message.id === undefined) return",
      "const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'github-fixture', version: '1.0.0' } } : message.method === 'tools/list' ? { tools } : {}",
      "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')",
      "})",
    ].join("\n");
    const previous = process.env.LOCAL_STUDIO_TEST_AMBIENT_SECRET;
    process.env.LOCAL_STUDIO_TEST_AMBIENT_SECRET = "must-not-leak";
    try {
      await Effect.runPromise(
        verifyGitHubMcpExecutable(process.execPath, {
          prefixArgs: ["-e", source],
          expectedTools,
          expectedInventoryDigest: GITHUB_MCP_INVENTORY_DIGEST,
          timeoutMs: 2_000,
        }),
      );
    } finally {
      if (previous === undefined) delete process.env.LOCAL_STUDIO_TEST_AMBIENT_SECRET;
      else process.env.LOCAL_STUDIO_TEST_AMBIENT_SECRET = previous;
    }
  });
});

describe("GitHub MCP artifact management HTTP", () => {
  test("requires a same-origin JSON install action", async () => {
    const root = await temporaryDataDir();
    const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
    const previousDesktop = process.env.LOCAL_STUDIO_DESKTOP;
    const previousFetch = globalThis.fetch;
    let fetches = 0;
    process.env.LOCAL_STUDIO_DATA_DIR = root;
    delete process.env.LOCAL_STUDIO_DESKTOP;
    globalThis.fetch = async () => {
      fetches += 1;
      throw new Error("unexpected download");
    };
    try {
      const foreign = await installGitHubArtifactHttp(
        new NextRequest("http://127.0.0.1/api/agent/connectors/github", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://foreign.invalid" },
          body: "{}",
        }),
      );
      expect(foreign.status).toBe(403);
      const simple = await installGitHubArtifactHttp(
        new NextRequest("http://127.0.0.1/api/agent/connectors/github", { method: "POST" }),
      );
      expect(simple.status).toBe(415);
      const invalidBody = await installGitHubArtifactHttp(
        new NextRequest("http://127.0.0.1/api/agent/connectors/github", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost" },
          body: JSON.stringify({ install: true }),
        }),
      );
      expect(invalidBody.status).toBe(400);
      for (const site of ["same-site", "cross-site"]) {
        const crossSite = await installGitHubArtifactHttp(
          new NextRequest("http://127.0.0.1/api/agent/connectors/github", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Sec-Fetch-Site": site },
            body: "{}",
          }),
        );
        expect(crossSite.status).toBe(403);
      }
      expect(fetches).toBe(0);
      expect(await readdir(root)).toEqual([]);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
      else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
      if (previousDesktop === undefined) delete process.env.LOCAL_STUDIO_DESKTOP;
      else process.env.LOCAL_STUDIO_DESKTOP = previousDesktop;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps web status read-only and denies both embedded desktop HTTP operations", async () => {
    const root = await temporaryDataDir();
    const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
    const previousDesktop = process.env.LOCAL_STUDIO_DESKTOP;
    process.env.LOCAL_STUDIO_DATA_DIR = root;
    delete process.env.LOCAL_STUDIO_DESKTOP;
    try {
      const status = await getGitHubArtifactHttp(
        new NextRequest("http://127.0.0.1/api/agent/connectors/github"),
      );
      expect(status.status).toBe(200);
      expect((await status.json()).state).toBe("not-installed");
      expect(await readdir(root)).toEqual([]);
      process.env.LOCAL_STUDIO_DESKTOP = "1";
      expect(
        (
          await getGitHubArtifactHttp(
            new NextRequest("http://127.0.0.1/api/agent/connectors/github"),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await installGitHubArtifactHttp(
            new NextRequest("http://127.0.0.1/api/agent/connectors/github", { method: "POST" }),
          )
        ).status,
      ).toBe(403);
      expect(await readdir(root)).toEqual([]);
    } finally {
      if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
      else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
      if (previousDesktop === undefined) delete process.env.LOCAL_STUDIO_DESKTOP;
      else process.env.LOCAL_STUDIO_DESKTOP = previousDesktop;
      await rm(root, { recursive: true, force: true });
    }
  });
});
