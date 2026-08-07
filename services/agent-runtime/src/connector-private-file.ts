import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { chmod, lstat, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";

export type ConnectorFileHandle = {
  readonly chmod: (mode: number) => Promise<void>;
  readonly close: () => Promise<void>;
  readonly readFile: (options: { readonly encoding: "utf-8" }) => Promise<string>;
  readonly stat: () => Promise<Stats>;
  readonly sync: () => Promise<void>;
  readonly writeFile: (data: string, options: { readonly encoding: "utf-8" }) => Promise<void>;
};

export type ConnectorFileSystem = {
  readonly chmod: (path: string, mode: number) => Promise<void>;
  readonly lstat: (path: string) => Promise<Stats>;
  readonly open: (path: string, flags: number, mode: number) => Promise<ConnectorFileHandle>;
  readonly rename: (source: string, destination: string) => Promise<void>;
  readonly unlink: (path: string) => Promise<void>;
};

export type ConnectorPersistenceIdentity = {
  readonly platform: NodeJS.Platform;
  readonly uid: number | undefined;
};

export type ConnectorDarwinSecurity = {
  readonly protect: (path: string, kind: "directory" | "file") => Promise<void>;
  readonly verify: (path: string, kind: "directory" | "file") => Promise<void>;
};

export type ConnectorWindowsSecurity = {
  readonly protect: (path: string, kind: "directory" | "file") => Promise<void>;
  readonly verify: (path: string, kind: "directory" | "file") => Promise<void>;
};

export type ConnectorPersistenceOptions = {
  readonly darwinSecurity?: ConnectorDarwinSecurity;
  readonly fileSystem?: ConnectorFileSystem;
  readonly identity?: ConnectorPersistenceIdentity;
  readonly windowsSecurity?: ConnectorWindowsSecurity;
};

type ConnectorPersistenceContext = {
  readonly darwinSecurity: ConnectorDarwinSecurity;
  readonly fileSystem: ConnectorFileSystem;
  readonly identity: ConnectorPersistenceIdentity;
  readonly windowsSecurity: ConnectorWindowsSecurity | undefined;
};

type ConnectorSecureHandle = {
  readonly handle: ConnectorFileHandle;
  readonly initial: Stats;
};

const execFileAsync = promisify(execFile);
const DARWIN_SECURITY_TIMEOUT_MS = 5_000;
const DARWIN_SECURITY_MAX_BUFFER_BYTES = 16 * 1024;
const DARWIN_SECURITY_ENVIRONMENT: NodeJS.ProcessEnv = {
  LANG: "C",
  LC_ALL: "C",
  NODE_ENV: "production",
};
const noFollowFlag = constants.O_NOFOLLOW ?? 0;
const defaultConnectorFileSystem: ConnectorFileSystem = {
  chmod,
  lstat,
  open: async (path, flags, mode) => {
    const handle = await open(path, flags, mode);
    return {
      chmod: (nextMode) => handle.chmod(nextMode),
      close: () => handle.close(),
      readFile: (options) => handle.readFile(options),
      stat: () => handle.stat(),
      sync: () => handle.sync(),
      writeFile: (data, options) => handle.writeFile(data, options),
    };
  },
  rename,
  unlink,
};
const defaultConnectorDarwinSecurity: ConnectorDarwinSecurity = {
  protect: async (path) => {
    await execFileAsync("/bin/chmod", ["-N", resolve(path)], {
      encoding: "utf8",
      env: DARWIN_SECURITY_ENVIRONMENT,
      maxBuffer: DARWIN_SECURITY_MAX_BUFFER_BYTES,
      timeout: DARWIN_SECURITY_TIMEOUT_MS,
      windowsHide: true,
    });
  },
  verify: async (path, kind) => {
    const { stdout } = await execFileAsync("/bin/ls", ["-lde", resolve(path)], {
      encoding: "utf8",
      env: DARWIN_SECURITY_ENVIRONMENT,
      maxBuffer: DARWIN_SECURITY_MAX_BUFFER_BYTES,
      timeout: DARWIN_SECURITY_TIMEOUT_MS,
      windowsHide: true,
    });
    if (/(?:^|\n)\s*\d+:\s/u.test(stdout)) {
      throw new Error(`Connector ${kind} ACL is unsafe`);
    }
  },
};

function fileOperation<A>(operation: () => Promise<A>) {
  return Effect.tryPromise({ try: operation, catch: (error) => error });
}

function verifyPathKind(metadata: Stats, kind: "directory" | "file"): void {
  const validKind = kind === "directory" ? metadata.isDirectory() : metadata.isFile();
  if (!validKind || metadata.isSymbolicLink()) {
    throw new Error(`Connector ${kind} is unsafe`);
  }
}

function verifyStablePath(initial: Stats, metadata: Stats, kind: "directory" | "file"): void {
  verifyPathKind(metadata, kind);
  if (initial.dev !== metadata.dev || initial.ino !== metadata.ino) {
    throw new Error(`Connector ${kind} changed during permission enforcement`);
  }
}

function verifyOwnerOnly(
  initial: Stats,
  metadata: Stats,
  kind: "directory" | "file",
  mode: number,
  uid: number,
): void {
  verifyStablePath(initial, metadata, kind);
  if (metadata.uid !== uid || (metadata.mode & 0o777) !== mode) {
    throw new Error(`Connector ${kind} permissions are unsafe`);
  }
}

function persistenceContext(options: ConnectorPersistenceOptions): ConnectorPersistenceContext {
  return {
    darwinSecurity: options.darwinSecurity ?? defaultConnectorDarwinSecurity,
    fileSystem: options.fileSystem ?? defaultConnectorFileSystem,
    identity: options.identity ?? {
      platform: process.platform,
      uid: process.getuid?.(),
    },
    windowsSecurity: options.windowsSecurity,
  };
}

function pathMetadata(
  fileSystem: ConnectorFileSystem,
  path: string,
): Effect.Effect<Stats, unknown> {
  return fileOperation(() => fileSystem.lstat(path));
}

function handleMetadata(handle: ConnectorFileHandle): Effect.Effect<Stats, unknown> {
  return fileOperation(() => handle.stat());
}

function verifyMetadata(operation: () => void): Effect.Effect<void, unknown> {
  return Effect.try({ try: operation, catch: (error) => error });
}

function enforceOwnerOnly(
  context: ConnectorPersistenceContext,
  path: string,
  kind: "directory" | "file",
  mode: number,
  secureHandle?: ConnectorSecureHandle,
) {
  return Effect.gen(function* () {
    const { darwinSecurity, fileSystem, identity, windowsSecurity } = context;
    const initial = secureHandle?.initial ?? (yield* pathMetadata(fileSystem, path));
    yield* verifyMetadata(() => verifyPathKind(initial, kind));
    if (secureHandle) {
      const opened = yield* handleMetadata(secureHandle.handle);
      yield* verifyMetadata(() => verifyStablePath(initial, opened, kind));
    }
    if (identity.platform === "win32") {
      if (!windowsSecurity) {
        return yield* Effect.fail(
          new Error("Connector owner-only ACL enforcement is unavailable on Windows"),
        );
      }
      yield* fileOperation(() => windowsSecurity.protect(path, kind));
      yield* fileOperation(() => windowsSecurity.verify(path, kind));
      const metadata = yield* pathMetadata(fileSystem, path);
      yield* verifyMetadata(() => verifyStablePath(initial, metadata, kind));
    } else {
      const uid = identity.uid;
      if (uid === undefined) {
        return yield* Effect.fail(new Error("Connector ownership verifier is unavailable"));
      }
      if (identity.platform === "darwin") {
        yield* fileOperation(() => darwinSecurity.protect(path, kind));
      }
      yield* fileOperation(() =>
        secureHandle ? secureHandle.handle.chmod(mode) : fileSystem.chmod(path, mode),
      );
      if (identity.platform === "darwin") {
        yield* fileOperation(() => darwinSecurity.verify(path, kind));
      }
      const metadata = yield* pathMetadata(fileSystem, path);
      yield* verifyMetadata(() => verifyOwnerOnly(initial, metadata, kind, mode, uid));
    }
    if (secureHandle) {
      const opened = yield* handleMetadata(secureHandle.handle);
      yield* verifyMetadata(() => verifyStablePath(initial, opened, kind));
    }
  });
}

function openSecureFile(
  context: ConnectorPersistenceContext,
  path: string,
  flags: number,
  mode: number,
  initial: Stats,
): Effect.Effect<ConnectorSecureHandle, unknown> {
  return fileOperation(() => context.fileSystem.open(path, flags, mode)).pipe(
    Effect.map((handle) => ({ handle, initial })),
  );
}

function closeHandle(handle: ConnectorFileHandle): Effect.Effect<void, unknown> {
  return fileOperation(() => handle.close());
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function readPrivateFile(
  file: string,
  context: ConnectorPersistenceContext,
): Effect.Effect<string | null, unknown> {
  return Effect.gen(function* () {
    const initial = yield* pathMetadata(context.fileSystem, file).pipe(
      Effect.catchIf(isMissingFile, () => Effect.succeed(null)),
    );
    if (initial === null) return null;
    yield* verifyMetadata(() => verifyPathKind(initial, "file"));
    yield* enforceOwnerOnly(context, dirname(file), "directory", 0o700);
    return yield* Effect.acquireUseRelease(
      openSecureFile(context, file, constants.O_RDONLY | noFollowFlag, 0, initial),
      (secure) =>
        Effect.gen(function* () {
          const { handle } = secure;
          yield* enforceOwnerOnly(context, file, "file", 0o600, secure);
          const payload = yield* fileOperation(() => handle.readFile({ encoding: "utf-8" }));
          const metadata = yield* handleMetadata(handle);
          yield* verifyMetadata(() => verifyStablePath(initial, metadata, "file"));
          return payload;
        }),
      ({ handle }) => closeHandle(handle),
    );
  });
}

function cleanupTemporary(
  fileSystem: ConnectorFileSystem,
  temporary: string,
  primary: unknown,
): Effect.Effect<never, unknown> {
  return fileOperation(() => fileSystem.unlink(temporary)).pipe(
    Effect.matchEffect({
      onFailure: (cleanup) =>
        Effect.fail(
          new AggregateError([primary, cleanup], "Connector temporary file cleanup failed"),
        ),
      onSuccess: () => Effect.fail(primary),
    }),
  );
}

function replacePrivateFile(file: string, payload: string, context: ConnectorPersistenceContext) {
  return Effect.gen(function* () {
    yield* enforceOwnerOnly(context, dirname(file), "directory", 0o700);
    const tempFile = `${file}.tmp-${process.pid}-${randomUUID()}`;
    let created = false;
    const staged = Effect.acquireUseRelease(
      fileOperation(() =>
        context.fileSystem.open(
          tempFile,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag,
          0o600,
        ),
      ).pipe(
        Effect.map((handle) => {
          created = true;
          return handle;
        }),
      ),
      (openHandle) =>
        Effect.gen(function* () {
          const initial = yield* handleMetadata(openHandle);
          yield* enforceOwnerOnly(context, tempFile, "file", 0o600, {
            handle: openHandle,
            initial,
          });
          yield* fileOperation(() => openHandle.writeFile(payload, { encoding: "utf-8" }));
          yield* fileOperation(() => openHandle.sync());
        }),
      closeHandle,
    ).pipe(
      Effect.flatMap(() => fileOperation(() => context.fileSystem.rename(tempFile, file))),
      Effect.catch((error) =>
        created ? cleanupTemporary(context.fileSystem, tempFile, error) : Effect.fail(error),
      ),
    );
    yield* staged;
  });
}

export function readConnectorPrivateFile(
  file: string,
  options: ConnectorPersistenceOptions = {},
): Promise<string | null> {
  const target = resolve(file);
  return Effect.runPromise(readPrivateFile(target, persistenceContext(options)));
}

export function replaceConnectorPrivateFile(
  file: string,
  payload: string,
  options: ConnectorPersistenceOptions = {},
): Promise<void> {
  const target = resolve(file);
  return Effect.runPromise(replacePrivateFile(target, payload, persistenceContext(options)));
}
