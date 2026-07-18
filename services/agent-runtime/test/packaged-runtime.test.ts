import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import afterPack from "../../../frontend/scripts/electron-builder-after-pack.mjs";
import afterSign, {
  releaseSigningExpected,
  verifySignedDesktopPackage,
} from "../../../frontend/scripts/electron-builder-after-sign.mjs";
import beforePack, {
  configureLocalMacSigning,
  desktopRuntimeTarget,
  stageDesktopRuntime,
} from "../../../frontend/scripts/stage-desktop-runtime.mjs";
import { verifiedPackagedRuntime } from "../../../frontend/desktop/runtime-identity";
import { executableSignaturePresent } from "../src/executable-identity.cjs";

const roots: string[] = [];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function packagedFixture(platform: "darwin" | "win32") {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "local-studio-packaged-runtime-")));
  roots.push(root);
  const resources =
    platform === "darwin"
      ? path.join(root, "Local Studio.app", "Contents", "Resources")
      : path.join(root, "resources");
  const runtimeDir = path.join(resources, "app", "runtime");
  const probeDir = path.join(resources, "desktop", "resources", "mcp");
  await Promise.all([
    mkdir(path.join(resources, "app", "frontend", ".next", "standalone"), { recursive: true }),
    mkdir(path.join(resources, "app", "agent-runtime"), { recursive: true }),
    mkdir(probeDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(resources, "app", "frontend", ".next", "standalone", "server.js"), ""),
    writeFile(path.join(resources, "app", "agent-runtime", "server.mjs"), ""),
    copyFile(
      path.join(repositoryRoot, "frontend/desktop/resources/mcp/packaged-stdio-probe.mjs"),
      path.join(probeDir, "packaged-stdio-probe.mjs"),
    ),
  ]);
  if (platform === "darwin" && process.platform === "darwin") {
    const contents = path.join(root, "Local Studio.app", "Contents");
    const executable = path.join(contents, "MacOS", "Local Studio");
    const unsignedElectron = path.join(root, "unsigned-electron");
    await mkdir(path.dirname(executable), { recursive: true });
    await copyFile(
      path.join(
        repositoryRoot,
        "frontend/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
      ),
      unsignedElectron,
    );
    const result = spawnSync("/usr/bin/codesign", ["--remove-signature", unsignedElectron]);
    if (result.status !== 0) throw new Error("Unsigned Electron fixture creation failed");
    await Promise.all([
      copyFile(unsignedElectron, executable),
      writeFile(
        path.join(contents, "Info.plist"),
        '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Local Studio</string><key>CFBundleIdentifier</key><string>org.local.studio.test</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>',
      ),
    ]);
    await rm(unsignedElectron);
  }
  return { resources, root, runtimeDir };
}

function packagingContext(root: string, platform: "darwin" | "win32", arch: 1 | 3) {
  return {
    appOutDir: root,
    arch,
    electronPlatformName: platform,
    packager: { appInfo: { productFilename: "Local Studio" } },
  };
}

async function normalizePackagedRuntimeModes(runtimeDir: string) {
  await Promise.all([
    chmod(path.join(runtimeDir, "node"), 0o555),
    chmod(path.join(runtimeDir, "LICENSE.node"), 0o444),
    chmod(path.join(runtimeDir, "runtime-manifest.json"), 0o444),
  ]);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function invalidAuthenticode(bytes: Buffer): Buffer {
  const optionalOffset = bytes.readUInt32LE(0x3c) + 24;
  const magic = bytes.readUInt16LE(optionalOffset);
  const certificateEntry = optionalOffset + (magic === 0x10b ? 128 : 144);
  const certificateOffset = Math.ceil(bytes.length / 8) * 8;
  const signed = Buffer.alloc(certificateOffset + 16);
  bytes.copy(signed);
  signed.writeUInt32LE(9, certificateOffset);
  signed.writeUInt16LE(0x200, certificateOffset + 4);
  signed.writeUInt16LE(0x2, certificateOffset + 6);
  signed.writeUInt8(0xff, certificateOffset + 8);
  signed.writeUInt32LE(certificateOffset, certificateEntry);
  signed.writeUInt32LE(16, certificateEntry + 4);
  return signed;
}

async function adHocResignRuntime(runtimeDir: string): Promise<{ before: string; after: string }> {
  const runtime = path.join(runtimeDir, "node");
  const before = sha256(await readFile(runtime));
  await chmod(runtime, 0o755);
  const result = spawnSync("/usr/bin/codesign", ["--force", "--sign", "-", runtime], {
    encoding: "utf8",
    maxBuffer: 16 * 1024,
    timeout: 10_000,
  });
  await chmod(runtime, 0o555);
  if (result.status !== 0) throw new Error("Ad-hoc runtime signing failed");
  return { before, after: sha256(await readFile(runtime)) };
}

async function mutateRuntimeCode(runtimeDir: string): Promise<void> {
  const runtime = path.join(runtimeDir, "node");
  const bytes = await readFile(runtime);
  bytes[0x4000] ^= 0xff;
  await chmod(runtime, 0o755);
  await writeFile(runtime, bytes);
  await chmod(runtime, 0o555);
}

async function adHocSign(entry: string): Promise<void> {
  const result = spawnSync("/usr/bin/codesign", ["--force", "--sign", "-", entry], {
    encoding: "utf8",
    maxBuffer: 16 * 1024,
    timeout: 10_000,
  });
  if (result.status !== 0) throw new Error("Ad-hoc signing failed");
}

async function signBundle(root: string, runtimeDir: string): Promise<void> {
  const runtime = path.join(runtimeDir, "node");
  await chmod(runtime, 0o755);
  await adHocSign(runtime);
  await chmod(runtime, 0o555);
  await adHocSign(path.join(root, "Local Studio.app"));
}

describe("packaged desktop runtime closure", () => {
  test("refuses a packaged app without the pinned standalone MCP runtime", async () => {
    const { root } = await packagedFixture("darwin");
    await expect(afterPack(packagingContext(root, "darwin", 3))).rejects.toThrow(
      "standalone Node runtime",
    );
  });

  test("refuses a runtime without its audited license closure", async () => {
    const { root, runtimeDir } = await packagedFixture("darwin");
    await stageDesktopRuntime({ electronPlatformName: "darwin", arch: 3 }, { output: runtimeDir });
    await rm(path.join(runtimeDir, "LICENSE.node"));
    await expect(afterPack(packagingContext(root, "darwin", 3))).rejects.toThrow("runtime closure");
  });

  test("probes stdio MCP through the verified target runtime closure", async () => {
    const { root, runtimeDir } = await packagedFixture("darwin");
    await stageDesktopRuntime({ electronPlatformName: "darwin", arch: 3 }, { output: runtimeDir });
    await normalizePackagedRuntimeModes(runtimeDir);
    await expect(afterPack(packagingContext(root, "darwin", 3))).resolves.toBeUndefined();
  });

  test("keeps afterPack, final signing hook, and startup bound to normalized code", async () => {
    if (process.platform !== "darwin") return;
    const { root, runtimeDir } = await packagedFixture("darwin");
    const context = packagingContext(root, "darwin", 3);
    await stageDesktopRuntime({ electronPlatformName: "darwin", arch: 3 }, { output: runtimeDir });
    const hashes = await adHocResignRuntime(runtimeDir);
    expect(hashes.after).not.toBe(hashes.before);
    await expect(afterPack(context)).resolves.toBeUndefined();
    expect(verifiedPackagedRuntime(runtimeDir, "darwin", "arm64").nodeRuntime).toBe(
      path.join(runtimeDir, "node"),
    );
    let signaturesVerified = false;
    await expect(
      verifySignedDesktopPackage(context, {
        signaturePresent: async () => true,
        verifySignatures: async () => {
          signaturesVerified = true;
        },
      }),
    ).resolves.toBeUndefined();
    expect(signaturesVerified).toBe(true);
    await mutateRuntimeCode(runtimeDir);
    await expect(afterPack(context)).rejects.toThrow("runtime closure");
    expect(() => verifiedPackagedRuntime(runtimeDir, "darwin", "arm64")).toThrow("runtime closure");
    await expect(
      verifySignedDesktopPackage(context, {
        signaturePresent: async () => true,
        verifySignatures: async () => {},
      }),
    ).rejects.toThrow("runtime closure");
  });

  test("verifies actual outer and nested macOS signatures before the final probe", async () => {
    if (process.platform !== "darwin") return;
    const { root, runtimeDir } = await packagedFixture("darwin");
    const context = packagingContext(root, "darwin", 3);
    await stageDesktopRuntime({ electronPlatformName: "darwin", arch: 3 }, { output: runtimeDir });
    await signBundle(root, runtimeDir);
    await expect(verifySignedDesktopPackage(context)).resolves.toBeUndefined();
    await chmod(path.join(runtimeDir, "node"), 0o755);
    const result = spawnSync("/usr/bin/codesign", [
      "--remove-signature",
      path.join(runtimeDir, "node"),
    ]);
    await chmod(path.join(runtimeDir, "node"), 0o555);
    if (result.status !== 0) throw new Error("Ad-hoc signature removal failed");
    await expect(verifySignedDesktopPackage(context)).rejects.toThrow(
      "Signed desktop package verification failed",
    );
  });

  test("removes only the stale outer macOS signature before release signing", async () => {
    if (process.platform !== "darwin") return;
    const { root, runtimeDir } = await packagedFixture("darwin");
    const context = packagingContext(root, "darwin", 3);
    const application = path.join(root, "Local Studio.app");
    const executable = path.join(application, "Contents", "MacOS", "Local Studio");
    const runtime = path.join(runtimeDir, "node");
    await stageDesktopRuntime({ electronPlatformName: "darwin", arch: 3 }, { output: runtimeDir });
    await signBundle(root, runtimeDir);
    await expect(afterPack(context)).resolves.toBeUndefined();
    expect(executableSignaturePresent(await readFile(executable), "darwin")).toBe(false);
    expect(spawnSync("/usr/bin/codesign", ["--verify", "--strict", runtime]).status).toBe(0);
    await expect(verifySignedDesktopPackage(context)).resolves.toBeUndefined();
    await adHocSign(application);
    await expect(verifySignedDesktopPackage(context)).resolves.toBeUndefined();
  });

  test("configures builder-integrated ad-hoc signing before local macOS staging", async () => {
    const base = packagingContext("/package", "darwin", 3);
    const context = {
      ...base,
      packager: {
        ...base.packager,
        platformSpecificBuildOptions: { identity: "release-identity" },
      },
    };
    const order: string[] = [];
    await expect(
      beforePack(context, {
        environment: { CI: "true" },
        hostPlatform: "darwin",
        stage: async (staged) => {
          order.push(staged.packager.platformSpecificBuildOptions.identity);
        },
      }),
    ).resolves.toBeUndefined();
    expect(order).toEqual(["-"]);
    expect(context.packager.platformSpecificBuildOptions.identity).toBe("-");
  });

  test("preserves configured signing for release signals and non-local macOS targets", () => {
    const releaseExpectations: Array<{
      environment: Record<string, string>;
      forceCodeSigning?: boolean;
      notarize?: boolean;
    }> = [
      { environment: { CSC_LINK: "release-identity" } },
      { environment: { LOCAL_STUDIO_REQUIRE_DESKTOP_SIGNING: "true" } },
      { environment: {}, forceCodeSigning: true },
      { environment: {}, notarize: true },
    ];
    for (const expectation of releaseExpectations) {
      const base = packagingContext("/package", "darwin", 3);
      const context = {
        ...base,
        packager: {
          ...base.packager,
          ...(expectation.forceCodeSigning ? { config: { forceCodeSigning: true } } : {}),
          platformSpecificBuildOptions: {
            identity: "release-identity",
            ...(expectation.notarize ? { notarize: true } : {}),
          },
        },
      };
      expect(configureLocalMacSigning(context, expectation.environment, "darwin")).toBe(false);
      expect(context.packager.platformSpecificBuildOptions.identity).toBe("release-identity");
    }
    for (const [hostPlatform, platform] of [
      ["linux", "darwin"],
      ["darwin", "win32"],
    ] as const) {
      const base = packagingContext("/package", platform, 1);
      const context = {
        ...base,
        packager: {
          ...base.packager,
          platformSpecificBuildOptions: { identity: "release-identity" },
        },
      };
      expect(configureLocalMacSigning(context, {}, hostPlatform)).toBe(false);
      expect(context.packager.platformSpecificBuildOptions.identity).toBe("release-identity");
    }
  });

  test("keeps afterSign verification-only for an unsigned local package", async () => {
    const context = packagingContext("/package", "win32", 1);
    const order: string[] = [];
    await expect(
      afterSign(context, {
        verifiedFiles: () => {
          order.push("files");
          return { runtime: "runtime", probe: "probe" };
        },
        signaturePresent: async () => {
          order.push("signature");
          return false;
        },
        signingExpected: () => {
          order.push("required");
          return false;
        },
        probe: async () => {
          order.push("probe");
        },
      }),
    ).resolves.toBeUndefined();
    expect(order).toEqual(["files", "signature", "required", "probe"]);
  });

  test("rejects an invalid present macOS signature without pre-sign normalization", async () => {
    if (process.platform !== "darwin") return;
    const { root, runtimeDir } = await packagedFixture("darwin");
    const context = packagingContext(root, "darwin", 3);
    const application = path.join(root, "Local Studio.app");
    const executable = path.join(application, "Contents", "MacOS", "Local Studio");
    await stageDesktopRuntime({ electronPlatformName: "darwin", arch: 3 }, { output: runtimeDir });
    await signBundle(root, runtimeDir);
    await writeFile(path.join(application, "Contents", "Info.plist"), "invalidated");
    expect(executableSignaturePresent(await readFile(executable), "darwin")).toBe(true);
    await expect(verifySignedDesktopPackage(context)).rejects.toThrow(
      "Signed desktop package verification failed",
    );
  });

  test("keeps the final closure and probe for an intentionally unsigned local package", async () => {
    const { root, runtimeDir } = await packagedFixture("darwin");
    const context = packagingContext(root, "darwin", 3);
    await stageDesktopRuntime({ electronPlatformName: "darwin", arch: 3 }, { output: runtimeDir });
    let signatureChecks = 0;
    await expect(
      verifySignedDesktopPackage(context, {
        signaturePresent: async () => false,
        signingExpected: () => false,
        verifySignatures: async () => {
          signatureChecks += 1;
        },
      }),
    ).resolves.toBeUndefined();
    expect(signatureChecks).toBe(0);
  });

  test("allows an unsigned macOS package in pull request CI", async () => {
    const { root, runtimeDir } = await packagedFixture("darwin");
    const context = packagingContext(root, "darwin", 3);
    await stageDesktopRuntime({ electronPlatformName: "darwin", arch: 3 }, { output: runtimeDir });
    let probed = false;
    await expect(
      verifySignedDesktopPackage(context, {
        signaturePresent: async () => false,
        signingExpected: (value) => releaseSigningExpected(value, { CI: "true" }),
        probe: async () => {
          probed = true;
        },
      }),
    ).resolves.toBeUndefined();
    expect(probed).toBe(true);
  });

  test("allows an unsigned local Windows package and keeps its final probe", async () => {
    const { root } = await packagedFixture("win32");
    const context = packagingContext(root, "win32", 1);
    await copyFile(
      path.join(repositoryRoot, "services/agent-runtime/native/windows-runtime-helper.exe"),
      path.join(root, "Local Studio.exe"),
    );
    let probed = false;
    await expect(
      verifySignedDesktopPackage(context, {
        verifiedFiles: () => ({ runtime: "runtime", probe: "probe" }),
        signingExpected: () => false,
        probe: async () => {
          probed = true;
        },
      }),
    ).resolves.toBeUndefined();
    expect(probed).toBe(true);
  });

  test("rejects a present but invalid Windows signature even for a local package", async () => {
    const { root } = await packagedFixture("win32");
    const context = packagingContext(root, "win32", 1);
    const helper = await readFile(
      path.join(repositoryRoot, "services/agent-runtime/native/windows-runtime-helper.exe"),
    );
    await writeFile(path.join(root, "Local Studio.exe"), invalidAuthenticode(helper));
    await expect(
      verifySignedDesktopPackage(context, {
        verifiedFiles: () => ({ runtime: "runtime", probe: "probe" }),
        signingExpected: () => false,
        verifySignatures: async () => {
          throw new Error("invalid signature");
        },
        probe: async () => {},
      }),
    ).rejects.toThrow("invalid signature");
  });

  test("rejects missing signatures required by force, notarization, or credentials", async () => {
    const { root, runtimeDir } = await packagedFixture("darwin");
    const base = packagingContext(root, "darwin", 3);
    await stageDesktopRuntime({ electronPlatformName: "darwin", arch: 3 }, { output: runtimeDir });
    const expectations = [
      {
        context: { ...base, packager: { ...base.packager, config: { forceCodeSigning: true } } },
        environment: {},
      },
      {
        context: {
          ...base,
          packager: { ...base.packager, platformSpecificBuildOptions: { notarize: true } },
        },
        environment: {},
      },
      { context: base, environment: { CSC_LINK: "release-identity" } },
      {
        context: base,
        environment: { LOCAL_STUDIO_REQUIRE_DESKTOP_SIGNING: "true" },
      },
    ];
    for (const expectation of expectations) {
      await expect(
        verifySignedDesktopPackage(expectation.context, {
          signaturePresent: async () => false,
          signingExpected: (value) => releaseSigningExpected(value, expectation.environment),
          probe: async () => {},
        }),
      ).rejects.toThrow("Signed desktop package verification failed");
    }
  });

  test("rejects a runtime closure mutation during desktop startup", async () => {
    const { runtimeDir } = await packagedFixture("darwin");
    await stageDesktopRuntime({ electronPlatformName: "darwin", arch: 3 }, { output: runtimeDir });
    expect(verifiedPackagedRuntime(runtimeDir, "darwin", "arm64").nodeRuntime).toBe(
      path.join(runtimeDir, "node"),
    );
    const license = path.join(runtimeDir, "LICENSE.node");
    await chmod(license, 0o600);
    await writeFile(license, "changed license closure");
    expect(() => verifiedPackagedRuntime(runtimeDir, "darwin", "arm64")).toThrow("runtime closure");
  });

  test("stages an arm64 Electron target while the host reports x64", async () => {
    const { runtimeDir } = await packagedFixture("darwin");
    const descriptor = Object.getOwnPropertyDescriptor(process, "arch");
    if (!descriptor) throw new Error("Process architecture descriptor is missing");
    Object.defineProperty(process, "arch", { ...descriptor, value: "x64" });
    try {
      expect(desktopRuntimeTarget("darwin", 3)).toEqual({
        platform: "darwin",
        arch: "arm64",
        key: "darwin-arm64",
      });
      await stageDesktopRuntime(
        { electronPlatformName: "darwin", arch: 3 },
        { output: runtimeDir },
      );
    } finally {
      Object.defineProperty(process, "arch", descriptor);
    }
    const manifest = JSON.parse(
      await readFile(path.join(runtimeDir, "runtime-manifest.json"), "utf8"),
    );
    expect(manifest.target).toEqual({
      platform: "darwin",
      arch: "arm64",
      key: "darwin-arm64",
    });
  });

  test("rejects installed package bytes that differ from the audited upstream executable", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "local-studio-runtime-source-")));
    roots.push(root);
    const packageRoot = path.join(root, "node_modules", "node-bin-darwin-arm64");
    await Promise.all([
      mkdir(path.join(root, "desktop"), { recursive: true }),
      mkdir(path.join(packageRoot, "bin"), { recursive: true }),
    ]);
    await Promise.all([
      copyFile(
        path.join(repositoryRoot, "frontend/desktop/runtime-sources.json"),
        path.join(root, "desktop", "runtime-sources.json"),
      ),
      copyFile(
        path.join(repositoryRoot, "frontend/package-lock.json"),
        path.join(root, "package-lock.json"),
      ),
      copyFile(
        path.join(repositoryRoot, "frontend/node_modules/node-bin-darwin-arm64/package.json"),
        path.join(packageRoot, "package.json"),
      ),
      copyFile(
        path.join(repositoryRoot, "frontend/node_modules/node-bin-darwin-arm64/LICENSE"),
        path.join(packageRoot, "LICENSE"),
      ),
      writeFile(path.join(packageRoot, "bin", "node"), "altered runtime"),
    ]);
    await expect(
      stageDesktopRuntime(
        { electronPlatformName: "darwin", arch: 3 },
        { frontendRoot: root, output: path.join(root, "runtime") },
      ),
    ).rejects.toThrow("upstream identity");
  });

  test("rejects a Darwin runtime staged for the wrong target architecture", async () => {
    const { root, runtimeDir } = await packagedFixture("darwin");
    await stageDesktopRuntime({ electronPlatformName: "darwin", arch: 3 }, { output: runtimeDir });
    await expect(afterPack(packagingContext(root, "darwin", 1))).rejects.toThrow("runtime target");
  });

  test("rejects a Windows package containing a runtime for another platform", async () => {
    const { root, runtimeDir } = await packagedFixture("win32");
    await stageDesktopRuntime({ electronPlatformName: "darwin", arch: 3 }, { output: runtimeDir });
    await expect(afterPack(packagingContext(root, "win32", 1))).rejects.toThrow("runtime target");
  });
});
