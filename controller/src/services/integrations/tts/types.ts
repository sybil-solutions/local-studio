export type TtsMode = "strict" | "best_effort";

export interface TtsSynthesisRequest {
  text: string;
  modelPath: string;
  outputPath: string;
  timeoutMs?: number;
}

export class TtsIntegrationError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: Record<string, unknown>;

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
