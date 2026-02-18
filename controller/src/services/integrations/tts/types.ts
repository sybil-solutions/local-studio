export type TtsMode = "strict" | "best_effort";

export interface TtsSynthesisRequest {
  text: string;
  modelPath: string;
  outputPath: string;
  timeoutMs?: number;
}

/**
 * Typed TTS error with HTTP status and details.
 */
export class TtsIntegrationError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  /**
   * Create a TTS integration error.
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
