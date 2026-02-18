// CRITICAL
import type { Orchestrator, JobReporter } from "./orchestrator";
import type { AppContext } from "../../types/context";
import { voiceAssistantTurn } from "./workflows/voice-assistant-turn";

const SUPPORTED_TYPES = new Set(["voice_assistant_turn"]);

/**
 * In-memory orchestrator that runs workflows directly in the controller process.
 */
export class MemoryOrchestrator implements Orchestrator {
  public readonly name = "memory";
  private readonly context: AppContext;

  public constructor(context: AppContext) {
    this.context = context;
  }

  public async execute(
    jobId: string,
    type: string,
    input: Record<string, unknown>,
    reporter: JobReporter,
  ): Promise<Record<string, unknown>> {
    if (!SUPPORTED_TYPES.has(type)) {
      throw new Error(`Unsupported workflow type: ${type}`);
    }

    reporter.status("running");
    reporter.log(`Starting ${type} via memory orchestrator`);

    if (type === "voice_assistant_turn") {
      return voiceAssistantTurn(this.context, jobId, input, reporter);
    }

    throw new Error(`No handler for type: ${type}`);
  }
}
