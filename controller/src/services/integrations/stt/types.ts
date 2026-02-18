export type SttMode = "strict" | "best_effort";

export interface SttTranscriptionRequest {
  audioPath: string;
  modelPath: string;
  language?: string;
  timeoutMs?: number;
}

export interface SttTranscriptionResult {
  text: string;
  stdout: string;
  stderr: string;
}

/**
 * Typed STT error with HTTP status and details.
 */
export class SttIntegrationError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  /**
   * Create an STT integration error.
   * @param status - HTTP status code to return.
   * @param code - Stable machine-readable error code.
   * @param message - Human-readable error detail.
   * @param details - Extra debugging payload.
   */
  public constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
