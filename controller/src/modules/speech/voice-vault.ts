import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect, Schema } from "effect";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_VERSION = 1;

export class VoiceVaultError extends Schema.TaggedErrorClass<VoiceVaultError>()("VoiceVaultError", {
  operation: Schema.Literals(["key", "encrypt", "decrypt", "read", "write", "delete"]),
  message: Schema.String,
  source: Schema.Unknown,
}) {}

const vaultError = (operation: VoiceVaultError["operation"], source: unknown): VoiceVaultError =>
  new VoiceVaultError({
    operation,
    message: `Voice vault ${operation} failed: ${String(source)}`,
    source,
  });

const hasErrorCode = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && "code" in error && typeof error.code === "string";

const configuredKey = (): Buffer | null => {
  const value = process.env["LOCAL_STUDIO_VOICE_MASTER_KEY"]?.trim();
  if (!value) return null;
  const key = /^[a-f\d]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES)
    throw new Error("LOCAL_STUDIO_VOICE_MASTER_KEY must encode 32 bytes");
  return key;
};

const loadOrCreateKey = (path: string): Effect.Effect<Buffer, VoiceVaultError> =>
  Effect.gen(function* () {
    const configured = yield* Effect.try({
      try: configuredKey,
      catch: (source) => vaultError("key", source),
    });
    if (configured) return configured;
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        try {
          await writeFile(path, randomBytes(KEY_BYTES), { flag: "wx", mode: 0o600 });
        } catch (error) {
          if (!hasErrorCode(error) || error.code !== "EEXIST") throw error;
        }
        await chmod(path, 0o600);
      },
      catch: (source) => vaultError("key", source),
    });
    const key = yield* Effect.tryPromise({
      try: () => readFile(path),
      catch: (source) => vaultError("key", source),
    });
    return yield* key.length === KEY_BYTES
      ? Effect.succeed(key)
      : Effect.fail(vaultError("key", "Voice vault key is invalid"));
  });

const encryptedBytes = (
  plaintext: Uint8Array,
  key: Buffer,
  id: string,
): Effect.Effect<Buffer, VoiceVaultError> =>
  Effect.try({
    try: () => {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(id));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Buffer.concat([Buffer.from([FORMAT_VERSION]), nonce, cipher.getAuthTag(), ciphertext]);
    },
    catch: (source) => vaultError("encrypt", source),
  });

const decryptedBytes = (
  encrypted: Uint8Array,
  key: Buffer,
  id: string,
): Effect.Effect<Buffer, VoiceVaultError> =>
  Effect.try({
    try: () => {
      const bytes = Buffer.from(encrypted);
      if (bytes.length <= 1 + NONCE_BYTES + TAG_BYTES || bytes[0] !== FORMAT_VERSION) {
        throw new Error("Voice profile data is invalid");
      }
      const nonceStart = 1;
      const tagStart = nonceStart + NONCE_BYTES;
      const dataStart = tagStart + TAG_BYTES;
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(nonceStart, tagStart));
      decipher.setAAD(Buffer.from(id));
      decipher.setAuthTag(bytes.subarray(tagStart, dataStart));
      return Buffer.concat([decipher.update(bytes.subarray(dataStart)), decipher.final()]);
    },
    catch: (source) => vaultError("decrypt", source),
  });

const writeAtomic = (path: string, bytes: Uint8Array): Effect.Effect<void, VoiceVaultError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(dirname(path), { recursive: true, mode: 0o700 }),
      catch: (source) => vaultError("write", source),
    });
    const temporaryPath = join(dirname(path), `.${randomBytes(12).toString("hex")}.tmp`);
    yield* Effect.acquireUseRelease(
      Effect.succeed(temporaryPath),
      (target) =>
        Effect.tryPromise({
          try: async () => {
            await writeFile(target, bytes, { mode: 0o600 });
            await rename(target, path);
            await chmod(path, 0o600);
          },
          catch: (source) => vaultError("write", source),
        }),
      (target) =>
        Effect.tryPromise({ try: () => unlink(target), catch: () => undefined }).pipe(
          Effect.ignore,
        ),
    );
  });

export class VoiceVault {
  constructor(private readonly directory: string) {}

  private keyPath(): string {
    return join(this.directory, "master.key");
  }

  private blobPath(id: string): string {
    return join(this.directory, "profiles", `${id}.bin`);
  }

  write(id: string, plaintext: Uint8Array): Effect.Effect<void, VoiceVaultError> {
    return loadOrCreateKey(this.keyPath()).pipe(
      Effect.flatMap((key) => encryptedBytes(plaintext, key, id)),
      Effect.flatMap((bytes) => writeAtomic(this.blobPath(id), bytes)),
    );
  }

  read(id: string): Effect.Effect<Buffer, VoiceVaultError> {
    return Effect.all(
      [
        loadOrCreateKey(this.keyPath()),
        Effect.tryPromise({
          try: () => readFile(this.blobPath(id)),
          catch: (source) => vaultError("read", source),
        }),
      ] as const,
      { concurrency: 2 },
    ).pipe(Effect.flatMap(([key, encrypted]) => decryptedBytes(encrypted, key, id)));
  }

  delete(id: string): Effect.Effect<void, VoiceVaultError> {
    return Effect.tryPromise({
      try: () => unlink(this.blobPath(id)),
      catch: (source) => {
        if (hasErrorCode(source) && source.code === "ENOENT") return null;
        return vaultError("delete", source);
      },
    }).pipe(Effect.catch((error) => (error === null ? Effect.void : Effect.fail(error))));
  }
}
