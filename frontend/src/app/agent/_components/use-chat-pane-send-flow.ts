"use client";

import { useCallback, useRef, type FormEvent } from "react";
import { promptRequestsBrowser } from "@/lib/agent/browser/intent";
import {
  activeComposerPlugins,
  selectedContextPrompt,
  type ComposerMention,
  type ComposerPluginRef,
} from "@/lib/agent/composer-context";
import { isPlaceholderSessionTitle, newId, type SessionTab } from "@/lib/agent/session";
import type { SessionEngine } from "@/lib/agent/sessions/engine";
import {
  beginSessionSubmit,
  endSessionSubmit,
  type SessionSubmitGuard,
} from "@/lib/agent/sessions/submit-guard";
import type { ToolsContextValue } from "@/lib/agent/tools/context";
import {
  attachmentPrompt,
  imageInputFromAttachment,
  type ChatAttachment,
} from "./chat-attachments";

type UpdateTab = (tabId: string, patch: (tab: SessionTab) => SessionTab) => void;

type UseChatPaneSendFlowOptions = {
  activeTab: SessionTab | null;
  attachments: ChatAttachment[];
  clearAttachments: () => void;
  cwd: string;
  engine: SessionEngine;
  modelId: string;
  readingAttachments: boolean;
  resetComposerHeight: () => void;
  running: boolean;
  runtimeSessionId: string;
  setMention: (mention: ComposerMention | null) => void;
  setStickToBottom: (stickToBottom: boolean) => void;
  tools: ToolsContextValue;
  updateTab: UpdateTab;
};

export function useChatPaneSendFlow({
  activeTab,
  attachments,
  clearAttachments,
  cwd,
  engine,
  modelId,
  readingAttachments,
  resetComposerHeight,
  running,
  runtimeSessionId,
  setMention,
  setStickToBottom,
  tools,
  updateTab,
}: UseChatPaneSendFlowOptions) {
  const composerSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());
  const controlSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());

  const ensureBrowserToolForText = useCallback(
    (text: string) => {
      if (!promptRequestsBrowser(text)) return;
      tools.setComputerTab("browser");
      tools.setBrowserEnabled(true);
    },
    [tools],
  );

  const buildPromptArgs = useCallback(
    (sessionId: string, rawText: string) => {
      const text = rawText.trim();
      const attachedText = attachmentPrompt(attachments);
      const attachmentSummary =
        attachments.length > 0
          ? `Attached: ${attachments.map((file) => file.name).join(", ")}`
          : "";
      const userText = text || attachmentSummary;
      const displayText = [text, attachmentSummary].filter(Boolean).join("\n\n");
      const selection = tools.selectionFor(sessionId);
      const contextText = selectedContextPrompt(
        text,
        activeComposerPlugins(selection.plugins),
        selection.skills,
      );
      const prompt = [contextText, attachedText].filter(Boolean).join("\n\n");
      const images = attachments.flatMap((file) => {
        const image = imageInputFromAttachment(file);
        return image ? [image] : [];
      });
      const messageAttachments = attachments.map((file) => {
        // Prefer the durable inline data URL over the ephemeral blob: URL when
        // available; blob URLs are tied to the composer document and can go stale
        // after a session is persisted and replayed.
        const durablePreviewUrl =
          file.mode === "data-url" && file.content.startsWith("data:")
            ? file.content
            : file.previewUrl;
        return {
          id: file.id,
          name: file.name,
          type: file.type,
          size: file.size,
          path: file.path,
          mode: file.mode,
          content: file.content,
          previewKind: file.previewKind,
          previewUrl: durablePreviewUrl,
        };
      });
      return {
        text,
        prompt,
        displayText,
        userText,
        images,
        attachments: messageAttachments,
        plugins: activeComposerPlugins(selection.plugins) as ComposerPluginRef[],
        skills: selection.skills,
        promptTemplates: selection.promptTemplates,
      };
    },
    [attachments, tools],
  );

  const submitPrompt = useCallback(
    async (rawText: string, targetTabId?: string) => {
      const targetId = targetTabId ?? activeTab?.id;
      if (!targetId) return;
      if ((!rawText.trim() && attachments.length === 0) || !modelId || readingAttachments) return;
      const args = buildPromptArgs(targetId, rawText);
      ensureBrowserToolForText(args.userText);
      const currentSelection = tools.selectionFor(targetId);
      if (currentSelection.skills.length > 0 || currentSelection.plugins.length > 0) {
        tools.setSelection(targetId, { ...currentSelection, skills: [], plugins: [] });
      }
      setStickToBottom(true);
      clearAttachments();
      resetComposerHeight();
      await engine.submitPrompt({ ...args, targetSessionId: targetId });
    },
    [
      activeTab,
      attachments.length,
      buildPromptArgs,
      clearAttachments,
      engine,
      ensureBrowserToolForText,
      modelId,
      readingAttachments,
      resetComposerHeight,
      setStickToBottom,
      tools,
    ],
  );

  const queueAndSendControl = useCallback(
    async (
      mode: "steer" | "follow_up",
      text: string,
      tab: SessionTab,
      runtime: string,
      cwdHint?: string,
    ) => {
      ensureBrowserToolForText(text);
      const queuedId = newId("queue");
      updateTab(tab.id, (t) => ({
        ...t,
        ...(cwdHint ? { cwd: t.cwd || cwdHint } : {}),
        input: "",
        error: "",
        queue:
          mode === "follow_up"
            ? [...(t.queue ?? []), { id: queuedId, mode, text, sent: true }]
            : t.queue,
      }));
      resetComposerHeight();
      const result = await engine.sendControl(mode, text, runtime, tab.id, tab.piSessionId);
      updateTab(tab.id, (t) => ({
        ...t,
        queue: result.ok ? t.queue : (t.queue ?? []).filter((item) => item.id !== queuedId),
        ...(result.ok ? {} : { input: text, error: result.error || "Message failed" }),
      }));
    },
    [engine, ensureBrowserToolForText, resetComposerHeight, updateTab],
  );

  const sendMessage = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!activeTab) return;
      const text = activeTab.input.trim();
      const runtime = activeTab.runtimeSessionId || runtimeSessionId;
      if (running) {
        if (!text || isPlaceholderSessionTitle(text) || readingAttachments) return;
        if (!modelId) {
          updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
          return;
        }
        if (!beginSessionSubmit(controlSubmitInFlightRef.current, activeTab.id)) return;
        setMention(null);
        try {
          await queueAndSendControl("steer", text, activeTab, runtime);
        } finally {
          endSessionSubmit(controlSubmitInFlightRef.current, activeTab.id);
        }
        return;
      }
      if (
        ((!text || isPlaceholderSessionTitle(text)) && attachments.length === 0) ||
        readingAttachments
      ) {
        return;
      }
      if (!modelId) {
        updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
        return;
      }
      if (!beginSessionSubmit(composerSubmitInFlightRef.current, activeTab.id)) return;
      setMention(null);
      try {
        await submitPrompt(text, activeTab.id);
      } finally {
        endSessionSubmit(composerSubmitInFlightRef.current, activeTab.id);
      }
    },
    [
      activeTab,
      attachments.length,
      modelId,
      queueAndSendControl,
      readingAttachments,
      running,
      runtimeSessionId,
      setMention,
      submitPrompt,
      updateTab,
    ],
  );

  const queueMessage = useCallback(async () => {
    if (!activeTab) return;
    const text = activeTab.input.trim();
    if (!text || isPlaceholderSessionTitle(text)) return;
    if (!modelId) {
      updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
      return;
    }
    if (running) {
      if (!beginSessionSubmit(controlSubmitInFlightRef.current, activeTab.id)) return;
      setMention(null);
      try {
        const runtime = activeTab.runtimeSessionId || runtimeSessionId;
        await queueAndSendControl("follow_up", text, activeTab, runtime, cwd);
      } finally {
        endSessionSubmit(controlSubmitInFlightRef.current, activeTab.id);
      }
      return;
    }
    if (!beginSessionSubmit(composerSubmitInFlightRef.current, activeTab.id)) return;
    setMention(null);
    try {
      await submitPrompt(text, activeTab.id);
    } finally {
      endSessionSubmit(composerSubmitInFlightRef.current, activeTab.id);
    }
  }, [
    activeTab,
    cwd,
    modelId,
    queueAndSendControl,
    running,
    runtimeSessionId,
    setMention,
    submitPrompt,
    updateTab,
  ]);

  const removeQueued = useCallback(
    (queueId: string) => {
      if (!activeTab) return;
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        queue: (tab.queue ?? []).filter((entry) => entry.id !== queueId),
      }));
    },
    [activeTab, updateTab],
  );

  const editQueued = useCallback(
    (queueId: string, text: string) => {
      if (!activeTab) return;
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        queue: (tab.queue ?? []).map((entry) =>
          entry.id === queueId ? { ...entry, text } : entry,
        ),
      }));
    },
    [activeTab, updateTab],
  );

  const steerQueued = useCallback(
    async (queueId: string) => {
      if (!activeTab) return;
      const item = (activeTab.queue ?? []).find((entry) => entry.id === queueId);
      if (!item) return;
      const runtime = activeTab.runtimeSessionId || runtimeSessionId;
      removeQueued(queueId);
      const result = await engine.sendControl(
        "steer",
        item.text,
        runtime,
        activeTab.id,
        activeTab.piSessionId,
      );
      if (!result.ok) {
        updateTab(activeTab.id, (t) => ({
          ...t,
          queue: [...(t.queue ?? []), item],
          error: result.error || "Steer failed",
        }));
      }
    },
    [activeTab, engine, removeQueued, runtimeSessionId, updateTab],
  );

  const abortTurn = useCallback(async () => {
    if (!activeTab) return;
    await engine.abortTurn(activeTab.id);
  }, [activeTab, engine]);

  return { sendMessage, queueMessage, removeQueued, editQueued, steerQueued, abortTurn };
}
