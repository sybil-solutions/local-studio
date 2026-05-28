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

export class SttIntegrationError extends Error {
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
