import { readFileSync } from "node:fs";
import path from "node:path";
import executableIdentity from "../../services/agent-runtime/src/executable-identity.cjs";
import { packagedMcpProbe, verifiedPackagedFiles } from "./electron-builder-after-pack.mjs";
import { desktopCommandSucceeds } from "./electron-builder-command.mjs";
import { releaseSigningExpected } from "./stage-desktop-runtime.mjs";

export { releaseSigningExpected };

const { executableSignaturePresent } = executableIdentity;

function signatureFailure() {
  return new Error("Signed desktop package verification failed");
}

function desktopPlatform(context) {
  return context.electronPlatformName === "mas" ? "darwin" : context.electronPlatformName;
}

function macApplication(context) {
  return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
}

function macExecutable(context) {
  return path.join(
    macApplication(context),
    "Contents",
    "MacOS",
    context.packager.appInfo.productFilename,
  );
}

function windowsApplication(context) {
  return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
}

async function verifiedCommand(command, args) {
  if (!(await desktopCommandSucceeds(command, args))) throw signatureFailure();
}

async function verifyMacSignatures(context, runtime) {
  if (process.platform !== "darwin") throw signatureFailure();
  await verifiedCommand("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    macApplication(context),
  ]);
  await verifiedCommand("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", runtime]);
}

export async function packageSignaturePresent(context) {
  const platform = desktopPlatform(context);
  if (["darwin", "win32"].includes(platform)) {
    try {
      const executable =
        platform === "darwin" ? macExecutable(context) : windowsApplication(context);
      return executableSignaturePresent(readFileSync(executable), platform);
    } catch {
      throw signatureFailure();
    }
  }
  return false;
}

async function verifyWindowsSignatures(context, runtime) {
  if (process.platform !== "win32") throw signatureFailure();
  const helper = path.join(path.dirname(runtime), "windows-runtime-helper.exe");
  const executable = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );
  for (const candidate of [helper, runtime, executable]) {
    await verifiedCommand(helper, ["verify-trust", candidate]);
  }
}

export async function verifyPlatformSignatures(context, verified) {
  const platform = desktopPlatform(context);
  if (platform === "darwin") return verifyMacSignatures(context, verified.runtime);
  if (platform === "win32") return verifyWindowsSignatures(context, verified.runtime);
  throw signatureFailure();
}

async function verifiedDesktopPackageSignatureState(context, dependencies = {}) {
  const verified = (dependencies.verifiedFiles ?? verifiedPackagedFiles)(context);
  const signed = await (dependencies.signaturePresent ?? packageSignaturePresent)(
    context,
    verified,
  );
  const signingExpected =
    !signed && Boolean((dependencies.signingExpected ?? releaseSigningExpected)(context));
  if (signed) {
    await (dependencies.verifySignatures ?? verifyPlatformSignatures)(context, verified);
  } else if (signingExpected) {
    throw signatureFailure();
  }
  await (dependencies.probe ?? packagedMcpProbe)(verified.runtime, verified.probe);
  return { signed, signingExpected, verified };
}

export async function verifySignedDesktopPackage(context, dependencies = {}) {
  await verifiedDesktopPackageSignatureState(context, dependencies);
}

export default async function afterSign(context, dependencies = {}) {
  const { signed } = await verifiedDesktopPackageSignatureState(context, dependencies);
  console.log(
    `  afterSign: ${signed ? "signed runtime closure, package signatures, and" : "unsigned local runtime closure and"} stdio MCP verified (${context.electronPlatformName})`,
  );
}
