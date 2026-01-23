import { randomUUID } from "node:crypto";
import type { ToolCall, ToolCallBuffer, ThinkState } from "./proxy-parsers";
import { createToolCallId, fixMalformedToolCalls, parseThinkTagsFromContent, parseToolCallsFromContent } from "./proxy-parsers";

export interface StreamUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface ProxyStreamOptionsDebug {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  toolCallBuffer: ToolCallBuffer;
  thinkState: ThinkState;
  extractToolName: (content: string) => string;
  onUsage?: (usage: StreamUsage) => void;
  onChunk?: (stage: string, data: unknown) => void;
}

export const createProxyStreamDebug = (options: ProxyStreamOptionsDebug): ReadableStream<Uint8Array> => {
  const { reader, toolCallBuffer, thinkState, extractToolName, onUsage, onChunk } = options;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let usageTracked = false;
  let chunkIndex = 0;

  const log = (stage: string, data: unknown): void => {
    if (onChunk) onChunk(stage, data);
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      const { value, done } = await reader.read();
      
      if (done) {
        log("STREAM_DONE", { toolCallBuffer, thinkState });
        
        const parsedTools: ToolCall[] = [];
        if (!toolCallBuffer.tool_calls_found && toolCallBuffer.tool_args) {
          const argsString = toolCallBuffer.tool_args.trim();
          let name = toolCallBuffer.tool_name;
          if (!name) name = extractToolName(toolCallBuffer.content);
          if (argsString.startsWith("{") && argsString.endsWith("}") && name) {
            parsedTools.push({
              index: 0,
              id: createToolCallId(),
              type: "function",
              function: { name, arguments: argsString },
            });
          }
        }
        if (parsedTools.length === 0 && !toolCallBuffer.tool_calls_found && toolCallBuffer.content) {
          const content = toolCallBuffer.content;
          const hasPattern = content.includes("</tool_call>") ||
            content.includes("<tool_call>") ||
            content.includes("</use_mcp_tool>") ||
            content.includes("use_mcp_tool>") ||
            (content.includes("\"name\"") && content.includes("\"arguments\""));
          if (hasPattern) {
            const parsed = parseToolCallsFromContent(content);
            parsedTools.push(...parsed);
          }
        }
        if (parsedTools.length > 0) {
          const finalChunk = {
            id: `chatcmpl-${randomUUID().slice(0, 8)}`,
            choices: [{ index: 0, delta: { tool_calls: parsedTools }, finish_reason: "tool_calls" }],
          };
          log("FINAL_TOOL_CHUNK", finalChunk);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
        }
        controller.close();
        return;
      }

      chunkIndex++;
      let chunk = decoder.decode(value, { stream: true });
      
      log(`RAW_CHUNK_${chunkIndex}`, { raw: chunk.slice(0, 500), thinkState: { ...thinkState } });

      // Skip user role echoes
      if (chunk.includes("\"role\":\"user\"") && chunk.includes("\"tool_calls\":[]")) {
        log(`SKIP_USER_ECHO_${chunkIndex}`, "Skipping user role echo");
        return;
      }

      // Remove duplicate reasoning field
      if (chunk.includes("\"reasoning\":") && chunk.includes("\"reasoning_content\":")) {
        log(`FIX_REASONING_${chunkIndex}`, "Removing duplicate reasoning field");
        const lines = chunk.split("\n");
        const fixed = lines.map((line) => {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            const dataJson = line.slice(6);
            if (!dataJson.trim()) return line;
            try {
              const data = JSON.parse(dataJson) as Record<string, unknown>;
              const choices = data["choices"];
              if (Array.isArray(choices)) {
                for (const choice of choices) {
                  const choiceRecord = choice as Record<string, unknown>;
                  const delta = choiceRecord["delta"] as Record<string, unknown> | undefined;
                  if (delta && delta["reasoning"]) {
                    delete delta["reasoning"];
                  }
                }
              }
              return `data: ${JSON.stringify(data)}`;
            } catch { return line; }
          }
          return line;
        });
        chunk = fixed.join("\n");
      }

      // THINK TAG PROCESSING
      const needsThinkParsing = chunk.includes("<think>") || chunk.includes("</think>") || thinkState.inThinking;
      log(`THINK_CHECK_${chunkIndex}`, { 
        hasOpenTag: chunk.includes("<think>"),
        hasCloseTag: chunk.includes("</think>"),
        inThinking: thinkState.inThinking,
        needsThinkParsing 
      });

      if (needsThinkParsing) {
        const lines = chunk.split("\n");
        const fixed = lines.map((line) => {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            const dataJson = line.slice(6);
            if (!dataJson.trim()) return line;
            try {
              const dataBefore = JSON.parse(dataJson) as Record<string, unknown>;
              log(`THINK_BEFORE_${chunkIndex}`, { 
                content: (dataBefore["choices"] as any)?.[0]?.delta?.content,
                reasoning_content: (dataBefore["choices"] as any)?.[0]?.delta?.reasoning_content,
                thinkState: { ...thinkState }
              });
              
              const dataAfter = parseThinkTagsFromContent(dataBefore, thinkState);
              
              log(`THINK_AFTER_${chunkIndex}`, { 
                content: (dataAfter["choices"] as any)?.[0]?.delta?.content,
                reasoning_content: (dataAfter["choices"] as any)?.[0]?.delta?.reasoning_content,
                thinkState: { ...thinkState }
              });
              
              return `data: ${JSON.stringify(dataAfter)}`;
            } catch { return line; }
          }
          return line;
        });
        chunk = fixed.join("\n");
      }

      // Tool call fixing
      if (chunk.includes("\"tool_calls\"") || chunk.includes("<tool_call>") || chunk.includes("\"name\"")) {
        log(`TOOL_CALL_CHECK_${chunkIndex}`, "Processing tool calls");
        const lines = chunk.split("\n");
        const fixed = lines.map((line) => {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            const dataJson = line.slice(6);
            if (!dataJson.trim()) return line;
            try {
              const data = JSON.parse(dataJson) as Record<string, unknown>;
              const updated = fixMalformedToolCalls(data, toolCallBuffer);
              return `data: ${JSON.stringify(updated)}`;
            } catch { return line; }
          }
          return line;
        });
        chunk = fixed.join("\n");
      }

      // Buffer content tracking
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          const jsonPart = line.slice(6);
          if (!jsonPart.trim()) continue;
          try {
            const data = JSON.parse(jsonPart) as Record<string, unknown>;
            if (!usageTracked && data["usage"] && onUsage) {
              const usage = data["usage"] as Record<string, number>;
              if (usage["prompt_tokens"] || usage["completion_tokens"]) {
                onUsage({ prompt_tokens: usage["prompt_tokens"] ?? 0, completion_tokens: usage["completion_tokens"] ?? 0 });
                usageTracked = true;
              }
            }
            const choices = data["choices"];
            if (Array.isArray(choices)) {
              for (const choice of choices) {
                const choiceRecord = choice as Record<string, unknown>;
                const delta = choiceRecord["delta"] as Record<string, unknown> | undefined;
                const content = typeof delta?.["content"] === "string" ? String(delta["content"]) : "";
                const reasoning = typeof delta?.["reasoning_content"] === "string" ? String(delta["reasoning_content"]) : "";
                if (content) toolCallBuffer.content += content;
                if (reasoning) toolCallBuffer.content += reasoning;
                const toolCalls = Array.isArray(delta?.["tool_calls"]) ? (delta?.["tool_calls"] as unknown[]) : [];
                if (toolCalls.length > 0) {
                  for (const toolCall of toolCalls) {
                    const toolRecord = toolCall as Record<string, unknown>;
                    const functionRecord = toolRecord["function"] as Record<string, unknown> | undefined;
                    const name = typeof functionRecord?.["name"] === "string" ? String(functionRecord["name"]) : "";
                    const args = typeof functionRecord?.["arguments"] === "string" ? String(functionRecord["arguments"]) : "";
                    if (name) { toolCallBuffer.tool_name = name; toolCallBuffer.tool_calls_found = true; }
                    if (args) toolCallBuffer.tool_args += args;
                  }
                }
              }
            }
          } catch { continue; }
        }
      }

      log(`OUTPUT_CHUNK_${chunkIndex}`, { output: chunk.slice(0, 500) });
      controller.enqueue(encoder.encode(chunk));
    },
    async cancel(): Promise<void> {
      await reader.cancel();
    },
  });
};
