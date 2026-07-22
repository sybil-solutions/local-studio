import { createToolCallStream } from "../src/modules/proxy/tool-call-stream";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const sseFrame = (delta: Record<string, unknown>): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify({ id: "c", choices: [{ index: 0, delta }] })}\n\n`);

export const doneFrame = (): Uint8Array => encoder.encode("data: [DONE]\n\n");

export interface ObservedDelta {
  content?: string;
  reasoning_content?: string;
  beforeDone: boolean;
}

export const runStream = async (
  frames: Uint8Array[],
  bufferImplicitReasoningContent: boolean,
): Promise<ObservedDelta[]> => {
  const source = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  });
  const reader = createToolCallStream(source, undefined, undefined, {
    bufferImplicitReasoningContent,
  }).getReader();
  const deltas: ObservedDelta[] = [];
  let doneSeen = false;
  let accumulator = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    accumulator += decoder.decode(value, { stream: true });
    let separatorIndex: number;
    while ((separatorIndex = accumulator.indexOf("\n\n")) >= 0) {
      const frame = accumulator.slice(0, separatorIndex);
      accumulator = accumulator.slice(separatorIndex + 2);
      const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      if (line === "data: [DONE]") {
        doneSeen = true;
        continue;
      }
      const parsed = JSON.parse(line.slice(6)) as {
        choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
      };
      const delta = parsed.choices?.[0]?.delta;
      if (delta && (delta.content || delta.reasoning_content)) {
        deltas.push({ ...delta, beforeDone: !doneSeen });
      }
    }
  }
  return deltas;
};
