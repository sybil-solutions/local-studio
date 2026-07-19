import { mapStopReason, type WireRecord } from "./anthropic-messages";

const isRecord = (value: unknown): value is WireRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const sseFrame = (event: string, data: WireRecord): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

interface OpenBlock {
  anthropicIndex: number;
  kind: "text" | "tool_use";
}

export interface AnthropicStreamTranslator {
  translateChunk: (chunk: WireRecord) => string[];
  finish: () => string[];
  usage: () => WireRecord | null;
}

export const createAnthropicStreamTranslator = (requestModel: string): AnthropicStreamTranslator => {
  let started = false;
  let nextIndex = 0;
  let openText: OpenBlock | null = null;
  const openTools = new Map<number, OpenBlock>();
  let stopReason = "end_turn";
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;

  const startMessage = (chunk: WireRecord): string => {
    started = true;
    const id = typeof chunk["id"] === "string" ? chunk["id"] : "msg_local";
    const model = typeof chunk["model"] === "string" ? chunk["model"] : requestModel;
    return sseFrame("message_start", {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  };

  const closeText = (frames: string[]): void => {
    if (!openText) return;
    frames.push(sseFrame("content_block_stop", { type: "content_block_stop", index: openText.anthropicIndex }));
    openText = null;
  };

  const closeTools = (frames: string[]): void => {
    for (const block of openTools.values()) {
      frames.push(sseFrame("content_block_stop", { type: "content_block_stop", index: block.anthropicIndex }));
    }
    openTools.clear();
  };

  const emitTextDelta = (frames: string[], text: string): void => {
    if (!openText) {
      closeTools(frames);
      openText = { anthropicIndex: nextIndex, kind: "text" };
      nextIndex += 1;
      frames.push(
        sseFrame("content_block_start", {
          type: "content_block_start",
          index: openText.anthropicIndex,
          content_block: { type: "text", text: "" },
        })
      );
    }
    frames.push(
      sseFrame("content_block_delta", {
        type: "content_block_delta",
        index: openText.anthropicIndex,
        delta: { type: "text_delta", text },
      })
    );
  };

  const emitToolDelta = (frames: string[], call: WireRecord): void => {
    const callIndex = typeof call["index"] === "number" ? call["index"] : 0;
    const fn = isRecord(call["function"]) ? call["function"] : {};
    let block = openTools.get(callIndex);
    if (!block) {
      closeText(frames);
      block = { anthropicIndex: nextIndex, kind: "tool_use" };
      nextIndex += 1;
      openTools.set(callIndex, block);
      frames.push(
        sseFrame("content_block_start", {
          type: "content_block_start",
          index: block.anthropicIndex,
          content_block: {
            type: "tool_use",
            id: typeof call["id"] === "string" ? call["id"] : `toolu_${callIndex}`,
            name: typeof fn["name"] === "string" ? fn["name"] : "",
            input: {},
          },
        })
      );
    }
    if (typeof fn["arguments"] === "string" && fn["arguments"].length > 0) {
      frames.push(
        sseFrame("content_block_delta", {
          type: "content_block_delta",
          index: block.anthropicIndex,
          delta: { type: "input_json_delta", partial_json: fn["arguments"] },
        })
      );
    }
  };

  const captureUsage = (chunk: WireRecord): void => {
    const usage = chunk["usage"];
    if (!isRecord(usage)) return;
    sawUsage = true;
    if (typeof usage["prompt_tokens"] === "number") inputTokens = usage["prompt_tokens"];
    if (typeof usage["completion_tokens"] === "number") outputTokens = usage["completion_tokens"];
  };

  const translateChunk = (chunk: WireRecord): string[] => {
    const frames: string[] = [];
    if (!started) frames.push(startMessage(chunk));
    captureUsage(chunk);
    const choice = asArray(chunk["choices"]).filter(isRecord)[0];
    if (!choice) return frames;
    const delta = isRecord(choice["delta"]) ? choice["delta"] : {};
    if (typeof delta["content"] === "string" && delta["content"].length > 0) {
      emitTextDelta(frames, delta["content"]);
    }
    for (const call of asArray(delta["tool_calls"]).filter(isRecord)) {
      emitToolDelta(frames, call);
    }
    if (typeof choice["finish_reason"] === "string") {
      stopReason = mapStopReason(choice["finish_reason"]);
    }
    return frames;
  };

  const finish = (): string[] => {
    const frames: string[] = [];
    if (!started) frames.push(startMessage({}));
    closeText(frames);
    closeTools(frames);
    frames.push(
      sseFrame("message_delta", {
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      })
    );
    frames.push(sseFrame("message_stop", { type: "message_stop" }));
    return frames;
  };

  const usage = (): WireRecord | null =>
    sawUsage ? { prompt_tokens: inputTokens, completion_tokens: outputTokens } : null;

  return { translateChunk, finish, usage };
};

export const parseSseLine = (line: string): WireRecord | "done" | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (payload === "[DONE]") return "done";
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
