export const MAX_MCP_STDIO_FRAME_BYTES = 4 * 1024 * 1024;

export type McpProtocolErrorCode =
  | "frame-too-large"
  | "invalid-utf8"
  | "malformed-json"
  | "invalid-json-rpc"
  | "unexpected-bootstrap"
  | "unexpected-message"
  | "unexpected-eof";

export class McpProtocolError extends Error {
  override readonly name = "McpProtocolError";

  constructor(
    readonly code: McpProtocolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class StdioJsonLineFramer {
  private storage: Buffer | null = null;
  private length = 0;
  private frameLimit: number;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  constructor(maxFrameBytes = MAX_MCP_STDIO_FRAME_BYTES) {
    this.frameLimit = this.validatedLimit(maxFrameBytes);
  }

  get maxFrameBytes(): number {
    return this.frameLimit;
  }

  setMaxFrameBytes(maxFrameBytes: number): void {
    if (this.length !== 0) throw new Error("MCP stdio frame limit cannot change mid-frame");
    this.frameLimit = this.validatedLimit(maxFrameBytes);
    this.storage = null;
  }

  private validatedLimit(maxFrameBytes: number): number {
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1) {
      throw new RangeError("MCP stdio frame limit must be a positive safe integer");
    }
    return maxFrameBytes;
  }

  get bufferedBytes(): number {
    return this.length;
  }

  push(chunk: Uint8Array, emit: (frame: string) => void): void {
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let offset = 0;
    let newline = bytes.indexOf(10, offset);
    while (newline !== -1) {
      this.append(bytes, offset, newline);
      this.emit(emit);
      offset = newline + 1;
      newline = bytes.indexOf(10, offset);
    }
    this.append(bytes, offset, bytes.length);
  }

  clear(): void {
    this.storage = null;
    this.length = 0;
  }

  private append(source: Buffer, start: number, end: number): void {
    const nextBytes = end - start;
    const required = this.length + nextBytes;
    if (required > this.maxFrameBytes) {
      this.clear();
      throw new McpProtocolError(
        "frame-too-large",
        `MCP stdio frame exceeds ${this.maxFrameBytes} bytes`,
      );
    }
    if (nextBytes === 0) return;
    source.copy(this.storageFor(required), this.length, start, end);
    this.length += nextBytes;
  }

  private storageFor(required: number): Buffer {
    const current = this.storage?.length ?? 0;
    if (this.storage && current >= required) return this.storage;
    const capacity = Math.min(
      this.maxFrameBytes,
      Math.max(required, current === 0 ? Math.min(4_096, this.maxFrameBytes) : current * 2),
    );
    const storage = Buffer.allocUnsafe(capacity);
    this.storage?.copy(storage, 0, 0, this.length);
    this.storage = storage;
    return storage;
  }

  private emit(emit: (frame: string) => void): void {
    const frame = this.storage?.subarray(0, this.length) ?? Buffer.alloc(0);
    this.length = 0;
    let decoded: string;
    try {
      decoded = this.decoder.decode(frame);
    } catch {
      this.clear();
      throw new McpProtocolError("invalid-utf8", "MCP stdio frame is not valid UTF-8");
    }
    emit(decoded);
  }
}
