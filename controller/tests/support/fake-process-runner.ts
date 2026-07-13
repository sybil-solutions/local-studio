import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type {
  CommandResult,
  ProcessRunner,
  RunSyncOptions,
  SpawnDetachedOptions,
  SpawnedProcess,
} from "../../../controller/src/core/command";

export type RecordedInvocation = {
  kind: "runSync" | "spawnDetached";
  command: string;
  args: string[];
};

/** Matches on the exact command or its basename (call sites may pass resolved paths). */
type CommandMatcher = string | ((command: string, args: string[]) => boolean);

export type FakeSpawnBehavior = {
  /** Reported child pid. Defaults to 42_000 + spawn index. */
  pid?: number;
  /** Emit an "error" event (e.g. ENOENT) instead of starting; pid stays undefined. */
  spawnError?: string;
  /** Exit with this code after `exitAfterMs`. Omit to keep the process "running". */
  exitCode?: number;
  exitAfterMs?: number;
  /** Lines streamed on stdout/stderr (newline-terminated) before any exit. */
  stdoutLines?: string[];
  stderrLines?: string[];
};

const matches = (matcher: CommandMatcher, command: string, args: string[]): boolean => {
  if (typeof matcher === "function") return matcher(command, args);
  return command === matcher || command.endsWith(`/${matcher}`);
};

class FakeSpawnedProcess implements SpawnedProcess {
  public exitCode: number | null = null;
  public readonly stdout: PassThrough | null;
  public readonly stderr: PassThrough | null;
  private readonly emitter = new EventEmitter();

  public constructor(
    public readonly pid: number | undefined,
    behavior: FakeSpawnBehavior,
    piped: boolean,
  ) {
    this.stdout = piped ? new PassThrough() : null;
    this.stderr = piped ? new PassThrough() : null;
    // Defer events one tick so callers can attach listeners first, mirroring
    // real child_process semantics.
    setTimeout(() => {
      if (behavior.spawnError) {
        this.emitter.emit("error", new Error(behavior.spawnError));
        return;
      }
      for (const line of behavior.stdoutLines ?? []) this.stdout?.write(`${line}\n`);
      for (const line of behavior.stderrLines ?? []) this.stderr?.write(`${line}\n`);
      if (behavior.exitCode !== undefined) {
        setTimeout(() => {
          this.exitCode = behavior.exitCode ?? 0;
          this.stdout?.end();
          this.stderr?.end();
          this.emitter.emit("exit");
        }, behavior.exitAfterMs ?? 10);
      }
    }, 0);
  }

  public on(event: "error" | "exit", listener: (...args: never[]) => void): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  public unref(): void {}
}

/**
 * Scriptable stand-in for `realProcessRunner`. Rules are matched in
 * registration order; unmatched sync commands succeed with empty output and
 * unmatched spawns stay "running" forever. Every invocation is recorded so
 * tests can assert the exact argv production code constructed.
 */
export class FakeProcessRunner implements ProcessRunner {
  public readonly invocations: RecordedInvocation[] = [];
  private readonly syncRules: Array<{ matcher: CommandMatcher; result: CommandResult }> = [];
  private readonly spawnRules: Array<{ matcher: CommandMatcher; behavior: FakeSpawnBehavior }> = [];
  private spawnCount = 0;

  public onRunSync(matcher: CommandMatcher, result: Partial<CommandResult>): this {
    this.syncRules.push({ matcher, result: { status: 0, stdout: "", stderr: "", ...result } });
    return this;
  }

  public onSpawn(matcher: CommandMatcher, behavior: FakeSpawnBehavior): this {
    this.spawnRules.push({ matcher, behavior });
    return this;
  }

  public runSync(command: string, args: string[], _options?: RunSyncOptions): CommandResult {
    this.invocations.push({ kind: "runSync", command, args: [...args] });
    const rule = this.syncRules.find((entry) => matches(entry.matcher, command, args));
    return rule ? { ...rule.result } : { status: 0, stdout: "", stderr: "" };
  }

  public spawnDetached(
    command: string,
    args: string[],
    options: SpawnDetachedOptions,
  ): SpawnedProcess {
    this.invocations.push({ kind: "spawnDetached", command, args: [...args] });
    const behavior = this.spawnRules.find((entry) => matches(entry.matcher, command, args))
      ?.behavior ?? {};
    this.spawnCount += 1;
    const pid = behavior.spawnError ? undefined : (behavior.pid ?? 42_000 + this.spawnCount);
    return new FakeSpawnedProcess(pid, behavior, options.stdio === "pipe");
  }

  public spawns(): RecordedInvocation[] {
    return this.invocations.filter((invocation) => invocation.kind === "spawnDetached");
  }
}
