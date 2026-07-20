import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authenticodeSignaturePresent,
  executableSignaturePresent,
  signingStableExecutableIdentity,
} from "../src/executable-identity.cjs";

const roots: string[] = [];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function peFixture(magic: 0x10b | 0x20b): Buffer {
  const peOffset = 0x80;
  const coffOffset = peOffset + 4;
  const optionalOffset = coffOffset + 20;
  const optionalSize = magic === 0x10b ? 0xe0 : 0xf0;
  const directoryOffset = optionalOffset + (magic === 0x10b ? 96 : 112);
  const sectionOffset = optionalOffset + optionalSize;
  const bytes = Buffer.alloc(0x400);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(peOffset, 0x3c);
  bytes.write("PE\0\0", peOffset, "binary");
  bytes.writeUInt16LE(magic === 0x10b ? 0x14c : 0x8664, coffOffset);
  bytes.writeUInt16LE(1, coffOffset + 2);
  bytes.writeUInt16LE(optionalSize, coffOffset + 16);
  bytes.writeUInt16LE(0x22, coffOffset + 18);
  bytes.writeUInt16LE(magic, optionalOffset);
  bytes.writeUInt32LE(0x1000, optionalOffset + 16);
  bytes.writeUInt32LE(0x1000, optionalOffset + 20);
  bytes.writeUInt32LE(0x1000, optionalOffset + 32);
  bytes.writeUInt32LE(0x200, optionalOffset + 36);
  bytes.writeUInt32LE(0x2000, optionalOffset + 56);
  bytes.writeUInt32LE(0x200, optionalOffset + 60);
  bytes.writeUInt32LE(16, optionalOffset + (magic === 0x10b ? 92 : 108));
  bytes.write(".text\0\0\0", sectionOffset, "binary");
  bytes.writeUInt32LE(0x200, sectionOffset + 8);
  bytes.writeUInt32LE(0x1000, sectionOffset + 12);
  bytes.writeUInt32LE(0x200, sectionOffset + 16);
  bytes.writeUInt32LE(0x200, sectionOffset + 20);
  bytes.writeUInt32LE(0x60000020, sectionOffset + 36);
  bytes.fill(0x5a, 0x200);
  bytes.fill(0, directoryOffset + 32, directoryOffset + 40);
  return bytes;
}

function peOffsets(bytes: Buffer): { checksum: number; certificate: number } {
  const optionalOffset = bytes.readUInt32LE(0x3c) + 24;
  const magic = bytes.readUInt16LE(optionalOffset);
  return {
    checksum: optionalOffset + 64,
    certificate: optionalOffset + (magic === 0x10b ? 128 : 144),
  };
}

function certificateEntry(payload: Buffer): Buffer {
  const length = 8 + payload.length;
  const entry = Buffer.alloc(Math.ceil(length / 8) * 8);
  entry.writeUInt32LE(length, 0);
  entry.writeUInt16LE(0x200, 4);
  entry.writeUInt16LE(0x2, 6);
  payload.copy(entry, 8);
  return entry;
}

function withCertificates(bytes: Buffer, payloads: Buffer[]): Buffer {
  const entries = payloads.map(certificateEntry);
  const table = Buffer.concat(entries);
  const tableOffset = Math.ceil(bytes.length / 8) * 8;
  const signed = Buffer.alloc(tableOffset + table.length);
  bytes.copy(signed);
  table.copy(signed, tableOffset);
  const offsets = peOffsets(signed);
  signed.writeUInt32LE(0x11223344, offsets.checksum);
  signed.writeUInt32LE(tableOffset, offsets.certificate);
  signed.writeUInt32LE(table.length, offsets.certificate + 4);
  return signed;
}

function codeMutation(bytes: Buffer, offset: number): Buffer {
  const changed = Buffer.from(bytes);
  changed[offset] ^= 0xff;
  return changed;
}

function duplicateMachOSignatureCommand(bytes: Buffer): Buffer {
  const changed = Buffer.from(bytes);
  const commandCount = changed.readUInt32LE(16);
  let offset = 32;
  let signature: Buffer | undefined;
  let replacement = -1;
  for (let index = 0; index < commandCount; index += 1) {
    const command = changed.readUInt32LE(offset);
    const size = changed.readUInt32LE(offset + 4);
    if (command === 0x1d) signature = Buffer.from(changed.subarray(offset, offset + 16));
    else if (size === 16) replacement = offset;
    offset += size;
  }
  if (!signature || replacement < 0) throw new Error("Mach-O fixture lacks suitable commands");
  signature.copy(changed, replacement);
  return changed;
}

async function adHocResigned(source: string, name: string): Promise<Buffer> {
  const root = await mkdtemp(path.join(tmpdir(), `local-studio-${name}-`));
  roots.push(root);
  const target = path.join(root, name);
  await copyFile(source, target);
  await chmod(target, 0o755);
  const result = spawnSync("/usr/bin/codesign", ["--force", "--sign", "-", target], {
    encoding: "utf8",
    maxBuffer: 16 * 1024,
    timeout: 10_000,
  });
  if (result.status !== 0) throw new Error("Ad-hoc signing fixture failed");
  return readFile(target);
}

async function signatureRemoved(source: string): Promise<Buffer> {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-unsigned-"));
  roots.push(root);
  const target = path.join(root, "node");
  await copyFile(source, target);
  const result = spawnSync("/usr/bin/codesign", ["--remove-signature", target], {
    encoding: "utf8",
    maxBuffer: 16 * 1024,
    timeout: 10_000,
  });
  if (result.status !== 0) throw new Error("Signature removal fixture failed");
  return readFile(target);
}

describe("signing-stable executable identity", () => {
  test("keeps thin Mach-O identity stable across real ad-hoc signing", async () => {
    if (process.platform !== "darwin") return;
    const source = path.join(
      repositoryRoot,
      "frontend/node_modules/node-bin-darwin-arm64/bin/node",
    );
    const before = await readFile(source);
    const after = await adHocResigned(source, "thin-node");
    const unsigned = await signatureRemoved(source);
    expect(sha256(after)).not.toBe(sha256(before));
    expect(executableSignaturePresent(after, "darwin")).toBe(true);
    expect(executableSignaturePresent(unsigned, "darwin")).toBe(false);
    expect(signingStableExecutableIdentity(before, "darwin")).toEqual(
      signingStableExecutableIdentity(after, "darwin"),
    );
    expect(signingStableExecutableIdentity(before, "darwin")).toEqual(
      signingStableExecutableIdentity(unsigned, "darwin"),
    );
    expect(signingStableExecutableIdentity(codeMutation(after, 0x4000), "darwin")).not.toEqual(
      signingStableExecutableIdentity(before, "darwin"),
    );
  });

  test("keeps universal Mach-O identity stable across real ad-hoc signing", async () => {
    if (process.platform !== "darwin") return;
    const before = await readFile("/usr/bin/true");
    const after = await adHocResigned("/usr/bin/true", "universal-true");
    expect(sha256(after)).not.toBe(sha256(before));
    expect(executableSignaturePresent(after, "darwin")).toBe(true);
    expect(signingStableExecutableIdentity(before, "darwin")).toEqual(
      signingStableExecutableIdentity(after, "darwin"),
    );
  });

  test("rejects duplicate and malformed Mach-O signature structures", async () => {
    if (process.platform !== "darwin") return;
    const source = await readFile(
      path.join(repositoryRoot, "frontend/node_modules/node-bin-darwin-arm64/bin/node"),
    );
    expect(() => signingStableExecutableIdentity(source.subarray(0, 64), "darwin")).toThrow();
    expect(() =>
      signingStableExecutableIdentity(duplicateMachOSignatureCommand(source), "darwin"),
    ).toThrow();
  });

  test("normalizes documented PE32 and PE32+ Authenticode fields only", () => {
    for (const magic of [0x10b, 0x20b] as const) {
      const unsigned = peFixture(magic);
      const first = withCertificates(unsigned, [Buffer.from("first-signature")]);
      const second = withCertificates(unsigned, [
        Buffer.from("second-signature"),
        Buffer.from("timestamp-signature"),
      ]);
      expect(sha256(first)).not.toBe(sha256(second));
      expect(authenticodeSignaturePresent(unsigned)).toBe(false);
      expect(authenticodeSignaturePresent(first)).toBe(true);
      expect(authenticodeSignaturePresent(second)).toBe(true);
      expect(signingStableExecutableIdentity(unsigned, "win32")).toEqual(
        signingStableExecutableIdentity(first, "win32"),
      );
      expect(signingStableExecutableIdentity(first, "win32")).toEqual(
        signingStableExecutableIdentity(second, "win32"),
      );
      expect(signingStableExecutableIdentity(codeMutation(second, 0x220), "win32")).not.toEqual(
        signingStableExecutableIdentity(unsigned, "win32"),
      );
    }
  });

  test("rejects truncated and malformed PE certificate tables", () => {
    const signed = withCertificates(peFixture(0x20b), [Buffer.from("signature")]);
    const malformedLength = Buffer.from(signed);
    const offsets = peOffsets(malformedLength);
    const tableOffset = malformedLength.readUInt32LE(offsets.certificate);
    malformedLength.writeUInt32LE(7, tableOffset);
    const malformedTotal = Buffer.from(signed);
    malformedTotal.writeUInt32LE(
      malformedTotal.readUInt32LE(offsets.certificate + 4) - 1,
      offsets.certificate + 4,
    );
    expect(() => signingStableExecutableIdentity(signed.subarray(0, 128), "win32")).toThrow();
    expect(() => signingStableExecutableIdentity(malformedLength, "win32")).toThrow();
    expect(() => signingStableExecutableIdentity(malformedTotal, "win32")).toThrow();
  });

  test("uses raw identity only for a bounded ELF executable", async () => {
    const executable = await readFile(process.execPath);
    if (executable.subarray(0, 4).toString("hex") !== "7f454c46") return;
    expect(signingStableExecutableIdentity(executable, "linux")).toEqual({
      algorithm: "sha256-v1",
      digest: sha256(executable),
    });
  });
});
