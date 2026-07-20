const { createHash } = require("node:crypto");

const MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024;
const MIN_EXECUTABLE_BYTES = 64;
const MACHO_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;
const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;
const EMBEDDED_SIGNATURE_MAGIC = 0xfade0cc0;
const AUDITED_NODE_IDENTITIES = Object.freeze({
  "darwin-arm64": Object.freeze({
    algorithm: "macho-unsigned-v1",
    digest: "40700d6e4d7db19f91765ab01997ef5105edfc5604d1ba72e40689f027143d1a",
  }),
  "darwin-x64": Object.freeze({
    algorithm: "macho-unsigned-v1",
    digest: "d0a7c8d6bbd664381711065f9bfeb598f48a02d9baac37d78d55ddcce4caf17d",
  }),
  "linux-arm64": Object.freeze({
    algorithm: "sha256-v1",
    digest: "6bf69d0eda41a12030d5f28d958cd09ce323bc0c13f1ab4d8bb426933aa08812",
  }),
  "linux-x64": Object.freeze({
    algorithm: "sha256-v1",
    digest: "41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c",
  }),
  "win32-x64": Object.freeze({
    algorithm: "pe-authenticode-v1",
    digest: "d8666eca32257f9e3f6d941a2d47fccf7dff840c62f9527d38500eca5f2a8604",
  }),
});
const AUDITED_NODE_EXECUTABLE_SHA256 = Object.freeze({
  "darwin-arm64": "ee6fb0e015284d83a91e8ec5213f43a157f8a392b58555301682892ba928c04a",
  "darwin-x64": "c5afe80c9fd47c0e1ba3a7221173d061dae04577acc67e21e945d16e34c696c8",
  "linux-arm64": "6bf69d0eda41a12030d5f28d958cd09ce323bc0c13f1ab4d8bb426933aa08812",
  "linux-x64": "41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c",
  "win32-x64": "9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de",
});
const AUDITED_WINDOWS_HELPER_IDENTITY = Object.freeze({
  algorithm: "pe-authenticode-v1",
  digest: "f978aeb390043dc0988a7d3efc4f9489628389b7e34d383dfd61fd2ea9ef66f7",
});
const AUDITED_WINDOWS_HELPER_BUILD = Object.freeze({
  format: "local-studio-windows-runtime-helper-v2",
  target: "x86_64-windows-gnu",
  zigVersion: "0.16.0",
  arguments: Object.freeze([
    "-O2",
    "-s",
    "-municode",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-ladvapi32",
    "-lwintrust",
  ]),
  sourceSha256: "9451940112793ef6adce2e35e2657b24a515fe9f639793175a1276ebf5032a9d",
  binarySha256: "581302d0025b2b4e15d3977705c2c2376b4f0346b164587f3ff95df639cf2bb4",
  codeIdentity: AUDITED_WINDOWS_HELPER_IDENTITY,
});

function failure() {
  return new Error("Executable identity is invalid");
}

function boundedBuffer(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (bytes.length < MIN_EXECUTABLE_BYTES || bytes.length > MAX_EXECUTABLE_BYTES) throw failure();
  return bytes;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function checkedEnd(offset, size, limit) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0) {
    throw failure();
  }
  const end = offset + size;
  if (!Number.isSafeInteger(end) || end > limit) throw failure();
  return end;
}

function pageSize(cpuType) {
  if (cpuType === CPU_TYPE_ARM64) return 0x4000;
  if (cpuType === CPU_TYPE_X86_64) return 0x1000;
  throw failure();
}

function aligned(value, alignment) {
  const result = Math.ceil(value / alignment) * alignment;
  if (!Number.isSafeInteger(result)) throw failure();
  return result;
}

function hashRanges(bytes, ranges) {
  const hash = createHash("sha256");
  for (const [start, end] of ranges) hash.update(bytes.subarray(start, end));
  return hash.digest("hex");
}

function segmentName(bytes, offset) {
  const name = bytes.subarray(offset, offset + 16);
  const end = name.indexOf(0);
  return name.subarray(0, end < 0 ? name.length : end).toString("ascii");
}

function normalizedMachOSlice(slice) {
  if (slice.length < 32 || slice.readUInt32LE(0) !== MACHO_MAGIC_64) throw failure();
  const cpuType = slice.readInt32LE(4);
  const cpuSubtype = slice.readInt32LE(8);
  const commandCount = slice.readUInt32LE(16);
  const commandBytes = slice.readUInt32LE(20);
  if (commandCount === 0 || commandCount > 4096 || commandBytes > 4 * 1024 * 1024) throw failure();
  const commandEnd = checkedEnd(32, commandBytes, slice.length);
  let offset = 32;
  let signature;
  let linkedit;
  for (let index = 0; index < commandCount; index += 1) {
    checkedEnd(offset, 8, commandEnd);
    const command = slice.readUInt32LE(offset);
    const size = slice.readUInt32LE(offset + 4);
    if (size < 8 || size % 8 !== 0) throw failure();
    const next = checkedEnd(offset, size, commandEnd);
    if (command === LC_CODE_SIGNATURE) {
      if (signature || size !== 16) throw failure();
      signature = {
        commandOffset: offset,
        dataOffset: slice.readUInt32LE(offset + 8),
        dataSize: slice.readUInt32LE(offset + 12),
      };
    }
    if (command === LC_SEGMENT_64 && segmentName(slice, offset + 8) === "__LINKEDIT") {
      if (linkedit || size < 72) throw failure();
      const fileOffset = Number(slice.readBigUInt64LE(offset + 40));
      if (!Number.isSafeInteger(fileOffset)) throw failure();
      linkedit = { commandOffset: offset, fileOffset };
    }
    offset = next;
  }
  if (offset !== commandEnd || !linkedit) throw failure();
  let unsignedEnd = slice.length;
  if (signature) {
    if (
      signature.commandOffset + 16 !== commandEnd ||
      signature.dataSize < 8 ||
      signature.dataOffset < commandEnd ||
      checkedEnd(signature.dataOffset, signature.dataSize, slice.length) !== slice.length ||
      slice.readUInt32BE(signature.dataOffset) !== EMBEDDED_SIGNATURE_MAGIC ||
      slice.readUInt32BE(signature.dataOffset + 4) > signature.dataSize ||
      slice.readUInt32BE(signature.dataOffset + 4) < 8
    ) {
      throw failure();
    }
    unsignedEnd = signature.dataOffset;
  }
  if (linkedit.fileOffset > unsignedEnd) throw failure();
  const normalized = Buffer.from(slice.subarray(0, unsignedEnd));
  if (signature) {
    normalized.writeUInt32LE(commandCount - 1, 16);
    normalized.writeUInt32LE(commandBytes - 16, 20);
    normalized.fill(0, signature.commandOffset, signature.commandOffset + 16);
  }
  const linkeditSize = unsignedEnd - linkedit.fileOffset;
  normalized.writeBigUInt64LE(
    BigInt(aligned(linkeditSize, pageSize(cpuType))),
    linkedit.commandOffset + 32,
  );
  normalized.writeBigUInt64LE(BigInt(linkeditSize), linkedit.commandOffset + 48);
  return { cpuType, cpuSubtype, signaturePresent: Boolean(signature), bytes: normalized };
}

function fatSlices(bytes) {
  const magic = bytes.readUInt32BE(0);
  if (magic !== FAT_MAGIC && magic !== FAT_MAGIC_64) return null;
  const count = bytes.readUInt32BE(4);
  const entrySize = magic === FAT_MAGIC ? 20 : 32;
  if (count === 0 || count > 16) throw failure();
  const headerEnd = checkedEnd(8, count * entrySize, bytes.length);
  const slices = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 8 + index * entrySize;
    const cpuType = bytes.readInt32BE(entry);
    const cpuSubtype = bytes.readInt32BE(entry + 4);
    const offset =
      magic === FAT_MAGIC
        ? bytes.readUInt32BE(entry + 8)
        : Number(bytes.readBigUInt64BE(entry + 8));
    const size =
      magic === FAT_MAGIC
        ? bytes.readUInt32BE(entry + 12)
        : Number(bytes.readBigUInt64BE(entry + 16));
    const alignment = bytes.readUInt32BE(entry + (magic === FAT_MAGIC ? 16 : 24));
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(size) ||
      alignment > 30 ||
      offset < headerEnd ||
      offset % 2 ** alignment !== 0 ||
      (magic === FAT_MAGIC_64 && bytes.readUInt32BE(entry + 28) !== 0)
    ) {
      throw failure();
    }
    const end = checkedEnd(offset, size, bytes.length);
    if (slices.some((slice) => offset < slice.end && end > slice.offset)) throw failure();
    const normalized = normalizedMachOSlice(bytes.subarray(offset, end));
    if (normalized.cpuType !== cpuType || normalized.cpuSubtype !== cpuSubtype) throw failure();
    slices.push({ offset, end, alignment, ...normalized });
  }
  return slices;
}

function machOIdentity(bytes) {
  const slices = fatSlices(bytes) ?? [
    { alignment: 0, offset: 0, end: bytes.length, ...normalizedMachOSlice(bytes) },
  ];
  const hash = createHash("sha256");
  hash.update("local-studio-macho-unsigned-v1\0");
  const count = Buffer.alloc(4);
  count.writeUInt32BE(slices.length);
  hash.update(count);
  for (const slice of slices) {
    const header = Buffer.alloc(20);
    header.writeInt32BE(slice.cpuType, 0);
    header.writeInt32BE(slice.cpuSubtype, 4);
    header.writeUInt32BE(slice.alignment, 8);
    header.writeBigUInt64BE(BigInt(slice.bytes.length), 12);
    hash.update(header);
    hash.update(slice.bytes);
  }
  return { algorithm: "macho-unsigned-v1", digest: hash.digest("hex") };
}

function peLayout(bytes) {
  if (bytes.subarray(0, 2).toString("ascii") !== "MZ") throw failure();
  const peOffset = bytes.readUInt32LE(0x3c);
  checkedEnd(peOffset, 24, bytes.length);
  if (bytes.subarray(peOffset, peOffset + 4).toString("binary") !== "PE\0\0") throw failure();
  const coffOffset = peOffset + 4;
  const sections = bytes.readUInt16LE(coffOffset + 2);
  const optionalSize = bytes.readUInt16LE(coffOffset + 16);
  const optionalOffset = coffOffset + 20;
  const optionalEnd = checkedEnd(optionalOffset, optionalSize, bytes.length);
  if (sections === 0 || sections > 96) throw failure();
  const magic = bytes.readUInt16LE(optionalOffset);
  if (magic !== 0x10b && magic !== 0x20b) throw failure();
  const directoryStart = optionalOffset + (magic === 0x10b ? 96 : 112);
  const directoryCountOffset = optionalOffset + (magic === 0x10b ? 92 : 108);
  checkedEnd(directoryCountOffset, 4, optionalEnd);
  if (bytes.readUInt32LE(directoryCountOffset) < 5) throw failure();
  const certificateEntry = checkedEnd(directoryStart, 40, optionalEnd) - 8;
  const sectionTable = optionalEnd;
  checkedEnd(sectionTable, sections * 40, bytes.length);
  const sizeOfHeaders = bytes.readUInt32LE(optionalOffset + 60);
  if (sizeOfHeaders < sectionTable + sections * 40 || sizeOfHeaders > bytes.length) throw failure();
  const certificateOffset = bytes.readUInt32LE(certificateEntry);
  const certificateSize = bytes.readUInt32LE(certificateEntry + 4);
  if ((certificateOffset === 0) !== (certificateSize === 0)) throw failure();
  const contentEnd = certificateOffset === 0 ? bytes.length : certificateOffset;
  if (certificateOffset !== 0) {
    if (
      certificateOffset % 8 !== 0 ||
      certificateSize < 8 ||
      checkedEnd(certificateOffset, certificateSize, bytes.length) !== bytes.length
    ) {
      throw failure();
    }
    let entry = certificateOffset;
    while (entry < bytes.length) {
      checkedEnd(entry, 8, bytes.length);
      const length = bytes.readUInt32LE(entry);
      const revision = bytes.readUInt16LE(entry + 4);
      const type = bytes.readUInt16LE(entry + 6);
      if (length < 8 || revision !== 0x200 || type !== 0x2) throw failure();
      entry = aligned(checkedEnd(entry, length, bytes.length), 8);
      if (entry > bytes.length) throw failure();
    }
    if (entry !== bytes.length) throw failure();
  }
  const sectionRanges = [];
  for (let index = 0; index < sections; index += 1) {
    const section = sectionTable + index * 40;
    const size = bytes.readUInt32LE(section + 16);
    const offset = bytes.readUInt32LE(section + 20);
    if (
      size !== 0 &&
      (offset < sizeOfHeaders || checkedEnd(offset, size, contentEnd) > contentEnd)
    ) {
      throw failure();
    }
    if (size !== 0) {
      const end = offset + size;
      if (sectionRanges.some((range) => offset < range.end && end > range.offset)) throw failure();
      sectionRanges.push({ offset, end });
    }
  }
  return { checksum: optionalOffset + 64, certificateEntry, certificateOffset, certificateSize };
}

function peIdentity(bytes) {
  const layout = peLayout(bytes);
  const contentEnd = layout.certificateOffset || bytes.length;
  return {
    algorithm: "pe-authenticode-v1",
    digest: hashRanges(bytes, [
      [0, layout.checksum],
      [layout.checksum + 4, layout.certificateEntry],
      [layout.certificateEntry + 8, contentEnd],
    ]),
  };
}

function authenticodeSignaturePresent(value) {
  return peLayout(boundedBuffer(value)).certificateSize !== 0;
}

function executableSignaturePresent(value, platform) {
  const bytes = boundedBuffer(value);
  if (platform === "darwin") {
    const slices = fatSlices(bytes) ?? [normalizedMachOSlice(bytes)];
    return slices.some((slice) => slice.signaturePresent);
  }
  if (platform === "win32") return peLayout(bytes).certificateSize !== 0;
  if (platform === "linux") {
    elfIdentity(bytes);
    return false;
  }
  throw failure();
}

function elfIdentity(bytes) {
  if (bytes.subarray(0, 4).toString("hex") !== "7f454c46") throw failure();
  return { algorithm: "sha256-v1", digest: digest(bytes) };
}

function signingStableExecutableIdentity(value, platform) {
  const bytes = boundedBuffer(value);
  if (platform === "darwin") return machOIdentity(bytes);
  if (platform === "win32") return peIdentity(bytes);
  if (platform === "linux") return elfIdentity(bytes);
  throw failure();
}

module.exports = {
  AUDITED_NODE_IDENTITIES,
  AUDITED_NODE_EXECUTABLE_SHA256,
  AUDITED_WINDOWS_HELPER_BUILD,
  AUDITED_WINDOWS_HELPER_IDENTITY,
  authenticodeSignaturePresent,
  executableSignaturePresent,
  signingStableExecutableIdentity,
};
