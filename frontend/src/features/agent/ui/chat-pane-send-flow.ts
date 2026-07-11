import { useCallback, useRef, type FormEvent } from "react";
import { Effect } from "effect";
import { type UpdateTab } from "@/features/agent/ui/chat-pane-composer";
import { browserContextPrompt } from "@/features/agent/browser/context";
import { selectedContextPrompt, type ComposerMention } from "@/features/agent/composer-context";
import {
  isPlaceholderSessionTitle,
  newId,
  nowLabel,
  type SessionTab,
} from "@/features/agent/messages";
import { type SessionEngine } from "@/features/agent/runtime/engine";
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

type UseChatPaneSendFlowOptions = {
  activeTab: SessionTab | null;
  attachments: ChatAttachment[];
  browserToolEnabled: boolean;
  clearAttachments: () => void;
  cwd: string;
  engine: SessionEngine;
  modelId: string;
  modelSupportsVision: boolean;
  readingAttachments: boolean;
  resetComposerHeight: () => void;
  running: boolean;
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
  running,
  setMention,
  setStickToBottom,
  tools,
  updateTab,
}: UseChatPaneSendFlowOptions) {
  const composerSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());
  const controlSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());

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
      const contextText = selectedContextPrompt(text, selection.skills, selection.plugins);
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
      tab: SessionTab,
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
              { id: pendingSteerId, role: "user", text, pending: true, timestamp: nowLabel() },
            ]
          : t.messages,
      }));
      resetComposerHeight();
      return Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () => engine.sendControl(mode, text, runtime, tab.id, tab.piSessionId),
            catch: (error) => error,
          });
          updateTab(tab.id, (t) => ({
            ...t,
            queue: result.ok ? t.queue : (t.queue ?? []).filter((item) => item.id !== queuedId),
            messages:
              !result.ok && pendingSteerId
                ? t.messages.filter((message) => message.id !== pendingSteerId)
                : t.messages,
            ...(result.ok ? {} : { input: text, error: result.error || "Message failed" }),
          }));
        }),
      );
    },
    [engine, resetComposerHeight, updateTab],
  );

  // Single-flight a submit through one of the in-flight guards: bail if this
  // session already has a submit pending, clear any open @mention, then run and
  // always release the guard. Shared by composer send, queue, and retry.
  const runGuardedSubmit = useCallback(
    (guard: SessionSubmitGuard, sessionId: string, run: () => Promise<void>) => {
      if (!beginSessionSubmit(guard, sessionId)) return Promise.resolve();
      setMention(null);
      return Effect.runPromise(
        Effect.tryPromise({ try: run, catch: (error) => error }).pipe(
          Effect.ensuring(Effect.sync(() => endSessionSubmit(guard, sessionId))),
        ),
      );
    },
    [setMention],
  );

  const sendMessage = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (!activeTab) return Promise.resolve();
      const text = activeTab.input.trim();
      // The session id is the opaque runtime key.
      const runtime = activeTab.id;
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
      return Effect.runPromise(
        Effect.gen(function* () {
          const acceptsControl = yield* Effect.tryPromise({
            try: () => engine.acceptsControl(activeTab, runtime),
            catch: () => false,
          });
          if (acceptsControl) {
            if (!text) return;
            yield* Effect.tryPromise({
              try: () =>
                runGuardedSubmit(controlSubmitInFlightRef.current, activeTab.id, () =>
                  queueAndSendControl("steer", text, activeTab, runtime),
                ),
              catch: (error) => error,
            });
            return;
          }
          yield* Effect.tryPromise({
            try: () =>
              runGuardedSubmit(composerSubmitInFlightRef.current, activeTab.id, () =>
                submitPrompt(text, activeTab.id),
              ),
            catch: (error) => error,
          });
        }),
      );
    },
    [
      activeTab,
      attachments.length,
      engine,
      modelId,
      queueAndSendControl,
      readingAttachments,
      runGuardedSubmit,
      submitPrompt,
      updateTab,
    ],
  );

  const queueMessage = useCallback(() => {
    if (!activeTab) return Promise.resolve();
    const text = activeTab.input.trim();
    if (!text || isPlaceholderSessionTitle(text)) return Promise.resolve();
    if (!modelId) {
      updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
      return Promise.resolve();
    }
    const runtime = activeTab.id;
    return Effect.runPromise(
      Effect.gen(function* () {
        const acceptsControl = yield* Effect.tryPromise({
          try: () => engine.acceptsControl(activeTab, runtime),
          catch: () => false,
        });
        if (acceptsControl) {
          yield* Effect.tryPromise({
            try: () =>
              runGuardedSubmit(controlSubmitInFlightRef.current, activeTab.id, () =>
                queueAndSendControl("follow_up", text, activeTab, runtime, cwd),
              ),
            catch: (error) => error,
          });
          return;
        }
        yield* Effect.tryPromise({
          try: () =>
            runGuardedSubmit(composerSubmitInFlightRef.current, activeTab.id, () =>
              submitPrompt(text, activeTab.id),
            ),
          catch: (error) => error,
        });
      }),
    );
  }, [
    activeTab,
    cwd,
    engine,
    modelId,
    queueAndSendControl,
    runGuardedSubmit,
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
    (queueId: string) => {
      if (!activeTab) return Promise.resolve();
      const item = (activeTab.queue ?? []).find((entry) => entry.id === queueId);
      if (!item) return Promise.resolve();
      const runtime = activeTab.id;
      removeQueued(queueId);
      return Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              engine.sendControl("steer", item.text, runtime, activeTab.id, activeTab.piSessionId),
            catch: (error) => error,
          });
          if (!result.ok) {
            updateTab(activeTab.id, (t) => ({
              ...t,
              queue: [...(t.queue ?? []), item],
              error: result.error || "Steer failed",
            }));
          }
        }),
      );
    },
    [activeTab, engine, removeQueued, updateTab],
  );

  const abortTurn = useCallback(() => {
    if (!activeTab) return Promise.resolve();
    return engine.abortTurn(activeTab.id);
  }, [activeTab, engine]);

  // Re-run the last user turn after a failure (a 503, a network blip). On a
  // *send* failure the text is restored to the composer, but a turn that errors
  // mid-stream leaves the prompt only in the transcript with an empty composer —
  // so retry resends the last user message directly.
  const retryLast = useCallback(() => {
    if (!activeTab || !modelId) return Promise.resolve();
    const lastUserText = [...activeTab.messages].reverse().find((m) => m.role === "user")?.text;
    const text = (lastUserText ?? activeTab.input).trim();
    if (!text) return Promise.resolve();
    return runGuardedSubmit(composerSubmitInFlightRef.current, activeTab.id, () => {
      updateTab(activeTab.id, (t) => ({ ...t, error: "", input: "" }));
      return submitPrompt(text, activeTab.id);
    });
  }, [activeTab, modelId, runGuardedSubmit, submitPrompt, updateTab]);

  return { sendMessage, queueMessage, removeQueued, editQueued, steerQueued, abortTurn, retryLast };
}
