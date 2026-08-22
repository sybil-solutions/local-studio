import { useCallback, useRef, type FormEvent } from "react";
import { type UpdateTab } from "@/features/agent/ui/chat-pane-composer";
import { browserContextPrompt } from "@/features/agent/tools/browser-context";
import { selectedContextPrompt, type ComposerMention } from "@/features/agent/composer-context";
import { isPlaceholderSessionTitle, newId, nowLabel } from "@/features/agent/messages";
import { type SessionEngine } from "@/features/agent/runtime/engine";
import type { Session } from "@/features/agent/runtime/types";
import {
  beginSessionSubmit,
  endSessionSubmit,
  type SessionSubmitGuard,
} from "@/features/agent/runtime/prompt-stream";
import { type ToolsContextValue } from "@/features/agent/tools/context";
import {
  attachmentPrompt,
  imageInputsFromAttachments,
  type ChatAttachment,
} from "@/features/agent/ui/chat-attachments";
import {
  messagesToResumeAfterAbort,
  removePendingSteersClearedByAbort,
} from "@/features/agent/ui/chat-pane-send-flow-model";

type UseChatPaneSendFlowOptions = {
  activeTab: Session | null;
  attachments: ChatAttachment[];
  browserToolEnabled: boolean;
  clearAttachments: () => void;
  cwd: string;
  engine: SessionEngine;
  modelId: string;
  modelSupportsVision: boolean;
  readingAttachments: boolean;
  resetComposerHeight: () => void;
  setMention: (mention: ComposerMention | null) => void;
  setStickToBottom: (stickToBottom: boolean) => void;
  tools: ToolsContextValue;
  updateTab: UpdateTab;
};

export function useChatPaneSendFlow({
  activeTab,
  attachments,
  browserToolEnabled,
  clearAttachments,
  cwd,
  engine,
  modelId,
  modelSupportsVision,
  readingAttachments,
  resetComposerHeight,
  setMention,
  setStickToBottom,
  tools,
  updateTab,
}: UseChatPaneSendFlowOptions) {
  const composerSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());
  const controlSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());
  const abortSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());

  const buildPromptArgs = useCallback(
    (sessionId: string, rawText: string, effectiveBrowserEnabled = browserToolEnabled) => {
      const text = rawText.trim();
      const attachedText = attachmentPrompt(attachments, { modelSupportsVision });
      const attachmentSummary =
        attachments.length > 0
          ? `Attached: ${attachments.map((file) => file.name).join(", ")}`
          : "";
      const userText = text || attachmentSummary;
      const displayText = [text, attachmentSummary].filter(Boolean).join("\n\n");
      const selection = tools.selectionFor(sessionId);
      const contextText = selectedContextPrompt(text, selection.skills);
      const browserContextText = browserContextPrompt({
        enabled: effectiveBrowserEnabled,
        backend: tools.browser.backend,
        url: tools.browser.url,
        vision: modelSupportsVision,
      });
      const prompt = [browserContextText, contextText, attachedText].filter(Boolean).join("\n\n");
      const images = modelSupportsVision ? imageInputsFromAttachments(attachments) : [];
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
        browserToolEnabled: effectiveBrowserEnabled,
        skills: selection.skills,
        promptTemplates: selection.promptTemplates,
      };
    },
    [attachments, browserToolEnabled, modelId, modelSupportsVision, tools],
  );

  const submitPrompt = useCallback(
    (rawText: string, targetTabId?: string) => {
      const targetId = targetTabId ?? activeTab?.id;
      if (!targetId) return Promise.resolve();
      if ((!rawText.trim() && attachments.length === 0) || !modelId || readingAttachments) {
        return Promise.resolve();
      }
      const args = buildPromptArgs(targetId, rawText, browserToolEnabled);
      const currentSelection = tools.selectionFor(targetId);
      if (currentSelection.skills.length > 0) {
        tools.setSelection(targetId, { ...currentSelection, skills: [] });
      }
      setStickToBottom(true);
      clearAttachments();
      resetComposerHeight();
      return engine.submitPrompt({ ...args, targetSessionId: targetId });
    },
    [
      activeTab,
      attachments.length,
      browserToolEnabled,
      buildPromptArgs,
      clearAttachments,
      engine,
      modelId,
      readingAttachments,
      resetComposerHeight,
      setStickToBottom,
      tools,
    ],
  );

  const queueAndSendControl = useCallback(
    (
      mode: "steer" | "follow_up",
      text: string,
      tab: Session,
      runtime: string,
      cwdHint?: string,
    ) => {
      const queuedId = newId("queue");
      // A steer lands in the transcript immediately, dimmed, so the user sees it
      // the moment they send it; the runtime echo clears `pending` once Pi shows
      // it to the model. (Follow-ups keep their own queue-chip affordance.)
      const pendingSteerId = mode === "steer" ? newId("user") : null;
      updateTab(tab.id, (t) => ({
        ...t,
        ...(cwdHint ? { cwd: t.cwd || cwdHint } : {}),
        input: "",
        error: "",
        queue:
          mode === "follow_up"
            ? [...(t.queue ?? []), { id: queuedId, mode, text, sent: true }]
            : t.queue,
        messages: pendingSteerId
          ? [
              ...t.messages,
              {
                id: pendingSteerId,
                role: "user",
                text,
                pending: true,
                awaitingEcho: true,
                timestamp: nowLabel(),
              },
            ]
          : t.messages,
      }));
      resetComposerHeight();
      return engine
        .sendControl({
          mode,
          text,
          runtime,
          sessionId: tab.id,
          piSessionId: tab.piSessionId,
        })
        .then((result) => {
          updateTab(tab.id, (t) => ({
            ...t,
            queue: result.ok ? t.queue : (t.queue ?? []).filter((item) => item.id !== queuedId),
            messages:
              !result.ok && pendingSteerId
                ? t.messages.filter((message) => message.id !== pendingSteerId)
                : t.messages,
            ...(result.ok ? {} : { input: text, error: result.error || "Message failed" }),
          }));
        });
    },
    [engine, resetComposerHeight, updateTab],
  );

  // Single-flight a submit through one of the in-flight guards: bail if this
  // session already has a submit pending, clear any open @mention, then run and
  // always release the guard. Shared by composer send, queue, and retry.
  const runGuardedSubmit = useCallback(
    async (guard: SessionSubmitGuard, sessionId: string, run: () => Promise<void>) => {
      if (!beginSessionSubmit(guard, sessionId)) return;
      setMention(null);
      try {
        await run();
      } finally {
        endSessionSubmit(guard, sessionId);
      }
    },
    [setMention],
  );

  // Composer send and queue share one tail: probe whether the runtime still
  // accepts control messages, then either steer/queue into the running turn or
  // start a fresh prompt, each behind its own single-flight guard.
  const dispatchComposerText = useCallback(
    async (mode: "steer" | "follow_up", text: string, tab: Session, cwdHint?: string) => {
      // The session id is the opaque runtime key.
      const runtime = tab.id;
      const acceptsControl = await engine.acceptsControl(tab, runtime);
      if (acceptsControl) {
        if (!text) return;
        await runGuardedSubmit(controlSubmitInFlightRef.current, tab.id, () =>
          queueAndSendControl(mode, text, tab, runtime, cwdHint),
        );
        return;
      }
      await runGuardedSubmit(composerSubmitInFlightRef.current, tab.id, () =>
        submitPrompt(text, tab.id),
      );
    },
    [engine, queueAndSendControl, runGuardedSubmit, submitPrompt],
  );

  const sendMessage = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (!activeTab) return Promise.resolve();
      const text = activeTab.input.trim();
      if (
        ((!text || isPlaceholderSessionTitle(text)) && attachments.length === 0) ||
        readingAttachments
      ) {
        return Promise.resolve();
      }
      if (!modelId) {
        updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
        return Promise.resolve();
      }
      return dispatchComposerText("steer", text, activeTab);
    },
    [activeTab, attachments.length, dispatchComposerText, modelId, readingAttachments, updateTab],
  );

  const queueMessage = useCallback(() => {
    if (!activeTab) return Promise.resolve();
    const text = activeTab.input.trim();
    if (!text || isPlaceholderSessionTitle(text)) return Promise.resolve();
    if (!modelId) {
      updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
      return Promise.resolve();
    }
    return dispatchComposerText("follow_up", text, activeTab, cwd);
  }, [activeTab, cwd, dispatchComposerText, modelId, updateTab]);

  // Queue edits are the same round-trip with a different `queueAction`: resolve
  // the queued item, ask the runtime to apply the action, surface a failure.
  const sendQueueAction = useCallback(
    (
      queueId: string,
      queueAction: "remove" | "replace",
      failureMessage: string,
      queueReplacement?: string,
    ) => {
      if (!activeTab) return Promise.resolve();
      const item = (activeTab.queue ?? []).find((entry) => entry.id === queueId);
      if (!item) return Promise.resolve();
      return engine
        .sendControl({
          mode: "follow_up",
          text: item.text,
          runtime: activeTab.id,
          sessionId: activeTab.id,
          piSessionId: activeTab.piSessionId,
          queueAction,
          ...(queueReplacement === undefined ? {} : { queueReplacement }),
        })
        .then((result) => {
          if (result.ok) return;
          updateTab(activeTab.id, (tab) => ({
            ...tab,
            error: result.error || failureMessage,
          }));
        });
    },
    [activeTab, engine, updateTab],
  );

  const removeQueued = useCallback(
    (queueId: string) => sendQueueAction(queueId, "remove", "Remove failed"),
    [sendQueueAction],
  );

  const editQueued = useCallback(
    (queueId: string, text: string) => sendQueueAction(queueId, "replace", "Edit failed", text),
    [sendQueueAction],
  );

  const steerQueued = useCallback(
    (queueId: string) => {
      if (!activeTab) return Promise.resolve();
      const item = (activeTab.queue ?? []).find((entry) => entry.id === queueId);
      if (!item) return Promise.resolve();
      const runtime = activeTab.id;
      // Promoting a queued follow-up to a steer delivers it into the running
      // turn immediately, so it lands in the transcript optimistically the same
      // way a composer steer does: dimmed until Pi echoes it back to the model.
      const pendingSteerId = newId("user");
      updateTab(activeTab.id, (t) => ({
        ...t,
        messages: [
          ...t.messages,
          {
            id: pendingSteerId,
            role: "user",
            text: item.text,
            pending: true,
            awaitingEcho: true,
            timestamp: nowLabel(),
          },
        ],
      }));
      return engine
        .sendControl({
          mode: "steer",
          text: item.text,
          runtime,
          sessionId: activeTab.id,
          piSessionId: activeTab.piSessionId,
          queueAction: "promote",
        })
        .then((result) => {
          if (result.ok) return;
          updateTab(activeTab.id, (t) => ({
            ...t,
            messages: t.messages.filter((message) => message.id !== pendingSteerId),
            error: result.error || "Steer failed",
          }));
        });
    },
    [activeTab, engine, updateTab],
  );

  const abortTurn = useCallback(() => {
    if (!activeTab) return Promise.resolve();
    const tab = activeTab;
    return runGuardedSubmit(abortSubmitInFlightRef.current, tab.id, async () => {
      const cleared = await engine.abortTurn(tab.id);
      const pending = messagesToResumeAfterAbort(tab.queue ?? [], cleared);
      if (pending.length === 0) return;
      updateTab(tab.id, (current) => ({
        ...current,
        queue: [],
        messages: removePendingSteersClearedByAbort(current.messages, cleared),
      }));
      const [next, ...remaining] = pending;
      if (!next) return;
      await submitPrompt(next, tab.id);
      for (const text of remaining) {
        await queueAndSendControl("follow_up", text, tab, tab.id, cwd);
      }
    });
  }, [activeTab, cwd, engine, queueAndSendControl, runGuardedSubmit, submitPrompt, updateTab]);

  return { sendMessage, queueMessage, removeQueued, editQueued, steerQueued, abortTurn };
}
