// CRITICAL
"use client";

import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import api from "@/lib/api";
import { createUuid } from "@/lib/uuid";
import type { ChatMessage, ChatMessagePart } from "@/lib/types";
import type { Attachment } from "@/app/chat/types";
import { parseChatModelId } from "@/app/chat/types";
import {
  buildAttachmentsBlock,
  readAttachmentContent,
  sanitizeAttachmentName,
  type UploadedAttachment,
} from "@/app/chat/utils/chat-attachments";
import { buildRunSystemPrompt } from "./run-system-prompt";

export interface UseChatSendUserMessageArgs {
  selectedModel: string;
  systemPrompt: string;
  mcpEnabled: boolean;
  deepResearchEnabled: boolean;
  agentMode: boolean;
  currentSessionId: string | null;
  currentSessionTitle: string;
  isLoading: boolean;
  agentFiles: Array<{ name: string; type: "file" | "dir"; children?: unknown[] }>;
  agentFileVersions: Record<string, unknown>;
  setInput: (value: string) => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setStreamError: (value: string | null) => void;
  setStreamingStartTime: (value: number | null) => void;
  lastUserInputRef: MutableRefObject<string>;
  createSession: (title: string, model: string) => Promise<{ id: string } | null>;
  setLastSessionId: (id: string) => void;
  replaceUrlToSession: (sessionId: string) => void;
  generateTitle: (sessionId: string, userContent: string, assistantContent: string) => Promise<string | null>;
  startRunStream: (
    sessionId: string,
    payload: {
      content: string;
      message_id: string;
      model?: string;
      provider?: string;
      system?: string;
      mcp_enabled?: boolean;
      agent_mode?: boolean;
      agent_files?: boolean;
      deep_research?: boolean;
    },
  ) => Promise<void>;
  loadAgentFiles: (args: { sessionId: string }) => void;
}

export function useChatSendUserMessage({
  selectedModel,
  systemPrompt,
  mcpEnabled,
  deepResearchEnabled,
  agentMode,
  currentSessionId,
  currentSessionTitle,
  isLoading,
  agentFiles,
  agentFileVersions,
  setInput,
  setMessages,
  setStreamError,
  setStreamingStartTime,
  lastUserInputRef,
  createSession,
  setLastSessionId,
  replaceUrlToSession,
  generateTitle,
  startRunStream,
  loadAgentFiles,
}: UseChatSendUserMessageArgs) {
  const isSendingRef = useRef(false);

  const uploadAttachments = useCallback(
    async (
      sessionId: string,
      attachments: Attachment[],
    ): Promise<{
      uploaded: UploadedAttachment[];
      failures: Array<{ name: string; error: string }>;
    }> => {
      if (attachments.length === 0) {
        return { uploaded: [], failures: [] };
      }

      const datePrefix = new Date().toISOString().slice(0, 10);
      const baseDir = `uploads/${datePrefix}`;

      const results = await Promise.all(
        attachments.map(async (attachment, index) => {
          try {
            const safeName = sanitizeAttachmentName(attachment.name || `attachment-${index + 1}`);
            const { content, encoding } = await readAttachmentContent(attachment);
            const fileName = `${createUuid()}-${safeName}${encoding === "base64" ? ".base64" : ""}`;
            const path = `${baseDir}/${fileName}`;
            await api.writeAgentFile(sessionId, path, { content });
            return {
              ok: true as const,
              entry: {
                name: attachment.name || safeName,
                path,
                size: attachment.size,
                type: attachment.type,
                encoding,
              },
            };
          } catch (error) {
            return {
              ok: false as const,
              name: attachment.name || `attachment-${index + 1}`,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );

      const uploaded = results.flatMap((result) => (result.ok ? [result.entry] : []));
      const failures = results.flatMap((result) =>
        result.ok ? [] : [{ name: result.name, error: result.error }],
      );

      if (uploaded.length > 0) {
        void loadAgentFiles({ sessionId });
      }

      return { uploaded, failures };
    },
    [loadAgentFiles],
  );

  const sendUserMessage = useCallback(
    async (text: string, attachments?: Attachment[], options?: { clearInput?: boolean }) => {
      if (!selectedModel) return;
      if (!text.trim() && (!attachments || attachments.length === 0)) return;
      if (isLoading || isSendingRef.current) return;
      isSendingRef.current = true;
      setStreamingStartTime(Date.now());
      setStreamError(null);

      if (options?.clearInput) {
        setInput("");
      }

      try {
        lastUserInputRef.current = text;

        const parts: ChatMessagePart[] = [];
        if (text.trim()) {
          parts.push({ type: "text", text });
        }

        if (attachments) {
          for (const att of attachments) {
            if (att.type === "image" && att.base64) {
              parts.push({ type: "text", text: `[Image: ${att.name}]` });
            } else if (att.type === "file" && att.file) {
              parts.push({ type: "text", text: `[File: ${att.name}]` });
            }
          }
        }

        const messageId = createUuid();
        const userMessage: ChatMessage = {
          id: messageId,
          role: "user",
          parts,
        };

        setMessages((prev) => [...prev, userMessage]);
        const removeLocalMessage = () => {
          setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
        };

        let sessionId = currentSessionId;
        if (!sessionId) {
          const session = await createSession("New Chat", selectedModel);
          if (!session) return;
          sessionId = session.id;
          setLastSessionId(sessionId);
          replaceUrlToSession(sessionId);
        }

        // Title as soon as the first user message lands (prefer LLM, fallback heuristic).
        if (sessionId && (currentSessionTitle === "New Chat" || currentSessionTitle === "Chat") && text.trim()) {
          void generateTitle(sessionId, text, "");
        }

        let attachmentsBlock: string | undefined;
        const hasAgentFiles = agentFiles.length > 0 || Object.keys(agentFileVersions).length > 0;
        let agentFilesEnabled = hasAgentFiles;
        if (attachments && attachments.length > 0) {
          const { uploaded, failures } = await uploadAttachments(sessionId, attachments);
          if (uploaded.length > 0) {
            attachmentsBlock = buildAttachmentsBlock(uploaded);
            agentFilesEnabled = true;
          }
          if (failures.length > 0) {
            const names = failures.map((failure) => failure.name).join(", ");
            setStreamError(`Failed to upload ${failures.length} attachment(s): ${names}`);
            if (uploaded.length === 0) {
              removeLocalMessage();
              return;
            }
          }
        }

        const runSystemPrompt = attachmentsBlock
          ? buildRunSystemPrompt(systemPrompt, attachmentsBlock)
          : systemPrompt.trim() || undefined;
        const parsedModel = parseChatModelId(selectedModel);

        await startRunStream(sessionId, {
          content: text,
          message_id: messageId,
          model: parsedModel.id || selectedModel,
          provider: parsedModel.provider,
          system: runSystemPrompt,
          mcp_enabled: mcpEnabled,
          agent_mode: agentMode,
          agent_files: agentFilesEnabled,
          deep_research: deepResearchEnabled,
        });
      } finally {
        isSendingRef.current = false;
      }
    },
    [
      agentFileVersions,
      agentFiles,
      agentMode,
      createSession,
      currentSessionId,
      currentSessionTitle,
      deepResearchEnabled,
      generateTitle,
      isLoading,
      lastUserInputRef,
      mcpEnabled,
      replaceUrlToSession,
      selectedModel,
      setInput,
      setLastSessionId,
      setMessages,
      setStreamError,
      setStreamingStartTime,
      startRunStream,
      systemPrompt,
      uploadAttachments,
    ],
  );

  return { sendUserMessage };
}
