import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import executableIdentity from "../src/executable-identity.cjs";

const { AUDITED_WINDOWS_HELPER_BUILD, signingStableExecutableIdentity } = executableIdentity;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRoot = path.join(packageRoot, "native");
const manifest = JSON.parse(
  await readFile(path.join(nativeRoot, "windows-runtime-helper.json"), "utf8"),
);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

if (JSON.stringify(manifest) !== JSON.stringify(AUDITED_WINDOWS_HELPER_BUILD)) {
  throw new Error("Windows runtime helper build identity is invalid");
}

const [source, binary, runtimeSource] = await Promise.all([
  readFile(path.join(nativeRoot, "windows-runtime-helper.c")),
  readFile(path.join(nativeRoot, "windows-runtime-helper.exe")),
  readFile(path.join(packageRoot, "src", "windows-runtime-helper.ts"), "utf8"),
]);
if (
  digest(source) !== manifest.sourceSha256 ||
  digest(binary) !== manifest.binarySha256 ||
  JSON.stringify(signingStableExecutableIdentity(binary, "win32")) !==
    JSON.stringify(manifest.codeIdentity) ||
  !runtimeSource.includes("AUDITED_WINDOWS_HELPER_IDENTITY")
) {
  throw new Error("Windows runtime helper digest is invalid");
}
