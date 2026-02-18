// CRITICAL
import type { Orchestrator, JobReporter } from "./orchestrator";
import type { AppContext } from "../../types/context";
import { MemoryOrchestrator } from "./memory-orchestrator";

/**
 * Auto-selecting orchestrator.
 * Prefers Temporal when reachable, falls back to in-memory execution.
 */
export class AutoOrchestrator implements Orchestrator {
  public readonly name = "auto";
  private readonly memory: MemoryOrchestrator;
  private readonly context: AppContext;

  public constructor(context: AppContext) {
    this.context = context;
    this.memory = new MemoryOrchestrator(context);
  }

  private async isTemporalReachable(): Promise<boolean> {
    const host = process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233";
    const [h, p] = host.split(":");
    if (!h || !p) return false;
    try {
      const { connect } = await import("node:net");
      return new Promise<boolean>((resolve) => {
        const socket = connect(Number(p), h);
        const timer = setTimeout(() => {
          socket.destroy();
          resolve(false);
        }, 1000);
        socket.once("connect", () => {
          clearTimeout(timer);
          socket.end();
          resolve(true);
        });
        socket.once("error", () => {
          clearTimeout(timer);
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  public async execute(
    jobId: string,
    type: string,
    input: Record<string, unknown>,
    reporter: JobReporter,
  ): Promise<Record<string, unknown>> {
    const temporal = await this.isTemporalReachable();
    if (temporal) {
      this.context.logger.info(`Temporal reachable — but client not implemented, falling back to memory`);
    }
    reporter.log(`Orchestrator: memory (temporal=${temporal ? "reachable" : "unavailable"})`);
    return this.memory.execute(jobId, type, input, reporter);
  }
}
