import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { Effect, Schema, Semaphore } from "effect";
import { openSqliteDatabase } from "../../stores/sqlite";
import { VoiceVault, type VoiceVaultError } from "./voice-vault";
import { prepareVoicePlaintextStorage } from "./storage";

export const VOICE_CONSENT_VERSION = "self_voice_v1";
const VOICE_ID_PATTERN = /^voice_[a-f\d]{32}$/;

export interface VoiceProfile {
  id: string;
  name: string;
  duration_ms: number;
  created_at: string;
}

type VoiceProfileRow = VoiceProfile & {
  consent_version: string;
  consented_at: string;
};

export class VoiceProfileError extends Schema.TaggedErrorClass<VoiceProfileError>()(
  "VoiceProfileError",
  { status: Schema.Number, code: Schema.String, message: Schema.String },
) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

export class VoiceStorePersistenceError extends Schema.TaggedErrorClass<VoiceStorePersistenceError>()(
  "VoiceStorePersistenceError",
  {
    operation: Schema.Literals(["open", "list", "get", "create", "delete", "plaintext", "close"]),
    message: Schema.String,
    source: Schema.Unknown,
  },
) {}

const persistenceError = (
  operation: VoiceStorePersistenceError["operation"],
  source: unknown,
): VoiceStorePersistenceError =>
  new VoiceStorePersistenceError({
    operation,
    message: `Voice profile ${operation} failed: ${String(source)}`,
    source,
  });

const voiceId = (): string => `voice_${randomUUID().replaceAll("-", "")}`;

const validId = (id: string): string => {
  if (!VOICE_ID_PATTERN.test(id)) {
    throw new VoiceProfileError(404, "voice_not_found", "Voice profile not found");
  }
  return id;
};

const validName = (name: string): string => {
  const value = name.trim();
  if (!value || value.length > 80) {
    throw new VoiceProfileError(400, "voice_name_invalid", "Voice name must be 1 to 80 characters");
  }
  return value;
};

const validDuration = (durationMs: number): number => {
  if (!Number.isInteger(durationMs) || durationMs < 6_000 || durationMs > 20_000) {
    throw new VoiceProfileError(
      400,
      "voice_duration_invalid",
      "Voice reference must be 6 to 20 seconds",
    );
  }
  return durationMs;
};

export class VoiceStore {
  private readonly db: Database;
  private readonly vault: VoiceVault;
  private readonly mutation = Semaphore.makeUnsafe(1);
  private readonly temporaryDirectory: string;

  constructor(dbPath: string, dataDirectory: string) {
    this.db = openSqliteDatabase(dbPath);
    try {
      this.vault = new VoiceVault(join(dataDirectory, "speech", "vault"));
      this.temporaryDirectory = join(dataDirectory, "runtime", "speech", "tmp");
      prepareVoicePlaintextStorage(this.temporaryDirectory);
      this.db.run(`
        CREATE TABLE IF NOT EXISTS speech_voice_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          duration_ms INTEGER NOT NULL,
          consent_version TEXT NOT NULL,
          consented_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
    } catch (source) {
      try {
        this.db.close();
      } catch {}
      throw persistenceError("open", source);
    }
  }

  list(): Effect.Effect<VoiceProfile[], VoiceStorePersistenceError> {
    return Effect.try({
      try: () =>
        this.db
          .query<
            VoiceProfile,
            []
          >("SELECT id, name, duration_ms, created_at FROM speech_voice_profiles ORDER BY created_at")
          .all(),
      catch: (source) => persistenceError("list", source),
    });
  }

  get(
    id: string,
  ): Effect.Effect<VoiceProfile | null, VoiceProfileError | VoiceStorePersistenceError> {
    return Effect.try({
      try: () =>
        this.db
          .query<
            VoiceProfile,
            [string]
          >("SELECT id, name, duration_ms, created_at FROM speech_voice_profiles WHERE id = ?")
          .get(validId(id)),
      catch: (source) =>
        source instanceof VoiceProfileError ? source : persistenceError("get", source),
    });
  }

  create(input: {
    name: string;
    durationMs: number;
    consent: string;
    audio: Uint8Array;
  }): Effect.Effect<
    VoiceProfile,
    VoiceProfileError | VoiceVaultError | VoiceStorePersistenceError
  > {
    const self = this;
    return this.mutation.withPermit(
      Effect.gen(function* () {
        const profile = yield* Effect.try({
          try: () => {
            if (input.consent !== VOICE_CONSENT_VERSION) {
              throw new VoiceProfileError(
                400,
                "voice_consent_required",
                "Confirm that the recording is your voice before saving it",
              );
            }
            if (input.audio.length === 0) {
              throw new VoiceProfileError(400, "voice_audio_invalid", "Voice reference is empty");
            }
            const createdAt = new Date().toISOString();
            return {
              id: voiceId(),
              name: validName(input.name),
              duration_ms: validDuration(input.durationMs),
              created_at: createdAt,
            } satisfies VoiceProfile;
          },
          catch: (source) =>
            source instanceof VoiceProfileError ? source : persistenceError("create", source),
        });
        yield* self.vault.write(profile.id, input.audio);
        const insert = Effect.try({
          try: () =>
            self.db
              .query(
                `INSERT INTO speech_voice_profiles
                 (id, name, duration_ms, consent_version, consented_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
              )
              .run(
                profile.id,
                profile.name,
                profile.duration_ms,
                input.consent,
                profile.created_at,
                profile.created_at,
              ),
          catch: (source) => persistenceError("create", source),
        });
        yield* insert.pipe(
          Effect.catch((error) =>
            self.vault.delete(profile.id).pipe(Effect.andThen(Effect.fail(error))),
          ),
        );
        return profile;
      }),
    );
  }

  delete(
    id: string,
  ): Effect.Effect<boolean, VoiceProfileError | VoiceVaultError | VoiceStorePersistenceError> {
    const self = this;
    return this.mutation.withPermit(
      Effect.gen(function* () {
        const normalizedId = yield* Effect.try({
          try: () => validId(id),
          catch: (source) =>
            source instanceof VoiceProfileError ? source : persistenceError("delete", source),
        });
        const existing = yield* self.get(normalizedId);
        if (!existing) return false;
        yield* self.vault.delete(normalizedId);
        return yield* Effect.try({
          try: () =>
            self.db.query("DELETE FROM speech_voice_profiles WHERE id = ?").run(normalizedId)
              .changes > 0,
          catch: (source) => persistenceError("delete", source),
        });
      }),
    );
  }

  withPlaintext<A, E, R>(
    id: string,
    use: (path: string) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | VoiceProfileError | VoiceVaultError | VoiceStorePersistenceError, R> {
    const self = this;
    return Effect.gen(function* () {
      const normalizedId = yield* Effect.try({
        try: () => validId(id),
        catch: (source) =>
          source instanceof VoiceProfileError ? source : persistenceError("plaintext", source),
      });
      const existing = yield* self.get(normalizedId);
      if (!existing) {
        return yield* Effect.fail(
          new VoiceProfileError(404, "voice_not_found", "Voice profile not found"),
        );
      }
      return yield* Effect.acquireUseRelease(
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () => mkdir(self.temporaryDirectory, { recursive: true, mode: 0o700 }),
            catch: (source) => persistenceError("plaintext", source),
          });
          const path = join(self.temporaryDirectory, `${randomUUID()}.wav`);
          const audio = yield* self.vault.read(normalizedId);
          yield* Effect.tryPromise({
            try: () => writeFile(path, audio, { mode: 0o600 }),
            catch: (source) => persistenceError("plaintext", source),
          });
          return path;
        }),
        use,
        (path) =>
          Effect.tryPromise({ try: () => unlink(path), catch: () => undefined }).pipe(
            Effect.ignore,
          ),
      );
    });
  }

  consentRecord(
    id: string,
  ): Effect.Effect<
    Pick<VoiceProfileRow, "consent_version" | "consented_at"> | null,
    VoiceProfileError | VoiceStorePersistenceError
  > {
    return Effect.try({
      try: () =>
        this.db
          .query<
            Pick<VoiceProfileRow, "consent_version" | "consented_at">,
            [string]
          >("SELECT consent_version, consented_at FROM speech_voice_profiles WHERE id = ?")
          .get(validId(id)),
      catch: (source) =>
        source instanceof VoiceProfileError ? source : persistenceError("get", source),
    });
  }

  close(): Effect.Effect<void, VoiceStorePersistenceError> {
    return Effect.try({
      try: () => this.db.close(),
      catch: (source) => persistenceError("close", source),
    });
  }
}
