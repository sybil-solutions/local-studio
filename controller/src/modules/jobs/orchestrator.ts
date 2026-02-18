/**
 * Orchestrator interface for job execution.
 */
export interface Orchestrator {
  /** Human-readable name. */
  readonly name: string;

  /**
   * Execute a workflow.
   * @param jobId - Job identifier.
   * @param type - Workflow type.
   * @param input - Workflow input.
   * @param reporter - Progress/log reporter.
   */
  execute(
    jobId: string,
    type: string,
    input: Record<string, unknown>,
    reporter: JobReporter,
  ): Promise<Record<string, unknown>>;
}

export interface JobReporter {
  progress(pct: number): void;
  log(message: string): void;
  status(status: "running" | "completed" | "failed"): void;
}
