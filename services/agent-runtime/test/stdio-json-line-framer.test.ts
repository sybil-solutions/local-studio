import { describe, expect, test } from "bun:test";
import {
  MAX_MCP_STDIO_FRAME_BYTES,
  McpProtocolError,
  StdioJsonLineFramer,
} from "../src/stdio-json-line-framer";

function framesFrom(framer: StdioJsonLineFramer, chunks: Uint8Array[]): string[] {
  const frames: string[] = [];
  for (const chunk of chunks) framer.push(chunk, (frame) => frames.push(frame));
  return frames;
}

describe("stdio JSON line framer", () => {
  test("uses the documented four MiB byte limit", () => {
    expect(MAX_MCP_STDIO_FRAME_BYTES).toBe(4 * 1024 * 1024);
  });

  test("preserves split UTF-8 and emits multiple and empty frames", () => {
    const bytes = Buffer.from('{"value":"€"}\n{"next":true}\n\n');
    const euro = bytes.indexOf(Buffer.from("€"));
    expect(
      framesFrom(new StdioJsonLineFramer(), [
        bytes.subarray(0, euro + 1),
        bytes.subarray(euro + 1, euro + 2),
        bytes.subarray(euro + 2),
      ]),
    ).toEqual(['{"value":"€"}', '{"next":true}', ""]);
  });

  test("accepts a frame exactly at the byte limit", () => {
    const framer = new StdioJsonLineFramer(8);
    const frames: string[] = [];
    framer.push(Buffer.from("aaaaaaaa"), (frame) => frames.push(frame));
    expect(framer.bufferedBytes).toBe(8);
    framer.push(Buffer.from("\n"), (frame) => frames.push(frame));
    expect(frames).toEqual(["aaaaaaaa"]);
    expect(framer.bufferedBytes).toBe(0);
  });

  test("rejects the first byte beyond the limit and clears the remainder", () => {
    const framer = new StdioJsonLineFramer(8);
    framer.push(Buffer.from("aaaaaaaa"), () => undefined);
    let failure: unknown;
    try {
      framer.push(Buffer.from("b"), () => undefined);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(McpProtocolError);
    expect(failure).toMatchObject({ code: "frame-too-large" });
    expect(framer.bufferedBytes).toBe(0);
  });

  test("rejects invalid UTF-8 only after a complete frame arrives", () => {
    const framer = new StdioJsonLineFramer();
    framer.push(Uint8Array.from([0xe2]), () => undefined);
    expect(framer.bufferedBytes).toBe(1);
    let failure: unknown;
    try {
      framer.push(Uint8Array.from([0x28, 0xa1, 0x0a]), () => undefined);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(McpProtocolError);
    expect(failure).toMatchObject({ code: "invalid-utf8" });
    expect(framer.bufferedBytes).toBe(0);
  });

  test("clear releases an incomplete frame", () => {
    const framer = new StdioJsonLineFramer();
    framer.push(Buffer.from("partial"), () => undefined);
    framer.clear();
    expect(framer.bufferedBytes).toBe(0);
    expect(framesFrom(framer, [Buffer.from("fresh\n")])).toEqual(["fresh"]);
  });
});
