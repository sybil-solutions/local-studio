import {
  ApprovalRequestId,
  EventId,
  type ItemLifecyclePayload,
  type ModelSelection,
  PI_DEFAULT_MODEL,
  type PiAgentSettings,
  type ProviderApprovalDecision,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  RuntimeItemId,
  RuntimeRequestId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { asRecord, asString, spawnPiRpc, type PiFrame, type PiRpc } from "./PiRpc.ts";
import { REASONING_OPTION_ID, splitModelSlug, type PiFlavor } from "./PiProvider.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventBody = DistributiveOmit<
  ProviderRuntimeEvent,
  "eventId" | "createdAt" | "provider" | "threadId"
>;
type ItemType = ItemLifecyclePayload["itemType"];
type ItemKind = "assistant" | "reasoning";
type Dialog = { readonly uiId: string; readonly method: string };

interface PiSessionContext {
  readonly threadId: ThreadId;
  readonly scope: Scope.Closeable;
  readonly dialogs: Map<ApprovalRequestId, Dialog>;
  readonly tools: Map<string, { readonly itemType: ItemType; readonly title: string }>;
  readonly open: Partial<Record<ItemKind, RuntimeItemId | undefined>>;
  session: ProviderSession;
  interrupted: boolean;
  streamed: boolean;
  stopping: boolean;
  seq: number;
  rpc?: PiRpc | undefined;
  sessionFile?: string | undefined;
  model?: string | undefined;
  effort?: string | undefined;
  contextWindow?: number | undefined;
  turnId?: TurnId | undefined;
  stopReason?: string | undefined;
  errorMessage?: string | undefined;
}

const TOOL_OUTPUT_LIMIT = 20_000;
const COMPACT_TIMEOUT_MS = 300_000;
const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
const DETAIL_ARGS = ["command", "path", "file_path", "pattern", "query", "url"];
const ITEM_TYPE: Record<ItemKind, ItemType> = {
  assistant: "assistant_message",
  reasoning: "reasoning",
};

const toolItemType = (name: string): ItemType =>
  name === "bash"
    ? "command_execution"
    : /^(edit|write|multi_edit|ast_edit|notebook)$/.test(name)
      ? "file_change"
      : name.startsWith("mcp_")
        ? "mcp_tool_call"
        : "dynamic_tool_call";

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => asString(asRecord(part).text) ?? "").join("")
      : "";

const toolDetail = (frame: PiFrame): string | undefined => {
  const args = asRecord(frame.args);
  const key = DETAIL_ARGS.find((name) => asString(args[name]));
  return (key ? asString(args[key])?.slice(0, 500) : undefined) ?? asString(frame.intent);
};

export const makePiAdapter = Effect.fn("makePiAdapter")(function* (
  flavor: PiFlavor,
  settings: PiAgentSettings,
  options: { readonly environment: NodeJS.ProcessEnv; readonly instanceId: ProviderInstanceId },
) {
  const PROVIDER = flavor.kind;
  type Shape = ProviderAdapterShape<ProviderAdapterError>;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const uuid = Effect.orDie(crypto.randomUUIDv4);
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, PiSessionContext>();
  const sessionDir = path.join(serverConfig.stateDir, "provider-sessions", PROVIDER);

  const emit = (ctx: PiSessionContext, body: EventBody) =>
    Effect.gen(function* () {
      yield* PubSub.publish(events, {
        eventId: EventId.make(yield* uuid),
        createdAt: yield* nowIso,
        provider: PROVIDER,
        providerInstanceId: options.instanceId,
        threadId: ctx.threadId,
        ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
        ...body,
      } as ProviderRuntimeEvent);
    });

  const requestError = (method: string, detail: string, cause?: unknown) =>
    new ProviderAdapterRequestError({ provider: PROVIDER, method, detail, cause });

  const processError = (threadId: ThreadId, detail: string) => (cause: unknown) =>
    new ProviderAdapterProcessError({ provider: PROVIDER, threadId, detail, cause });

  const requireSession = (threadId: ThreadId) => {
    const ctx = sessions.get(threadId);
    return ctx && !ctx.stopping
      ? Effect.succeed(ctx)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
  };

  const rpcOf = (ctx: PiSessionContext, method: string) =>
    ctx.rpc ? Effect.succeed(ctx.rpc) : Effect.fail(requestError(method, "Session is not ready."));

  const item = (
    ctx: PiSessionContext,
    type: "item.started" | "item.updated" | "item.completed",
    itemId: RuntimeItemId,
    payload: ItemLifecyclePayload,
  ) => emit(ctx, { type, itemId, payload });

  const openItem = (ctx: PiSessionContext, kind: ItemKind) => {
    const existing = ctx.open[kind];
    if (existing) return Effect.succeed(existing);
    const itemId = RuntimeItemId.make(`${ctx.turnId ?? ctx.threadId}:${kind}:${++ctx.seq}`);
    ctx.open[kind] = itemId;
    return item(ctx, "item.started", itemId, {
      itemType: ITEM_TYPE[kind],
      status: "inProgress",
    }).pipe(Effect.as(itemId));
  };

  const closeItem = (ctx: PiSessionContext, kind: ItemKind, detail?: string) => {
    const itemId = ctx.open[kind];
    ctx.open[kind] = undefined;
    return itemId
      ? item(ctx, "item.completed", itemId, {
          itemType: ITEM_TYPE[kind],
          status: "completed",
          ...(detail?.trim() ? { detail } : {}),
        })
      : Effect.void;
  };

  const streamDelta = (ctx: PiSessionContext, kind: ItemKind, delta: string) =>
    Effect.gen(function* () {
      if (kind === "assistant") yield* closeItem(ctx, "reasoning");
      const itemId = yield* openItem(ctx, kind);
      ctx.streamed = true;
      yield* emit(ctx, {
        type: "content.delta",
        itemId,
        payload: { streamKind: kind === "assistant" ? "assistant_text" : "reasoning_text", delta },
      });
    });

  const finishAssistantMessage = (ctx: PiSessionContext, message: PiFrame) =>
    Effect.gen(function* () {
      const text = textOf(message.content);
      if (!ctx.streamed && text) yield* streamDelta(ctx, "assistant", text);
      yield* closeItem(ctx, "reasoning");
      yield* closeItem(ctx, "assistant", text);
      ctx.stopReason = asString(message.stopReason);
      ctx.errorMessage = asString(message.errorMessage);
      const usage = asRecord(message.usage);
      const used = Number(usage.totalTokens);
      if (used > 0) {
        yield* emit(ctx, {
          type: "thread.token-usage.updated",
          payload: {
            usage: {
              usedTokens: used,
              inputTokens: Number(usage.input) || 0,
              outputTokens: Number(usage.output) || 0,
              cachedInputTokens: Number(usage.cacheRead) || 0,
              ...(ctx.contextWindow ? { maxTokens: ctx.contextWindow } : {}),
            },
          },
        });
      }
    });

  const handleToolFrame = (ctx: PiSessionContext, frame: PiFrame) =>
    Effect.gen(function* () {
      const callId = asString(frame.toolCallId);
      if (!callId) return;
      const itemId = RuntimeItemId.make(callId);
      if (frame.type === "tool_execution_start") {
        const title = asString(frame.toolName) ?? "tool";
        const itemType = toolItemType(title);
        const detail = toolDetail(frame);
        ctx.tools.set(callId, { itemType, title });
        yield* item(ctx, "item.started", itemId, {
          itemType,
          status: "inProgress",
          title,
          ...(detail ? { detail } : {}),
          data: { toolName: title, args: frame.args },
        });
        return;
      }
      const tool = ctx.tools.get(callId);
      if (!tool) return;
      if (frame.type !== "tool_execution_end") return;
      const output = textOf(asRecord(frame.result).content);
      ctx.tools.delete(callId);
      yield* item(ctx, "item.completed", itemId, {
        itemType: tool.itemType,
        status: frame.isError === true ? "failed" : "completed",
        title: tool.title,
        data: { output: output.slice(0, TOOL_OUTPUT_LIMIT), isError: frame.isError === true },
      });
    });

  const openDialog = (ctx: PiSessionContext, frame: PiFrame) =>
    Effect.gen(function* () {
      const uiId = asString(frame.id);
      const method = asString(frame.method);
      if (!uiId || !method || !DIALOG_METHODS.has(method)) return;
      const title = asString(frame.title) ?? "Input requested";
      const choices = (Array.isArray(frame.options) ? frame.options : []).filter(
        (option): option is string => typeof option === "string",
      );
      const requestId = ApprovalRequestId.make(yield* uuid);
      const runtimeRequestId = RuntimeRequestId.make(requestId);
      const approval = method === "select" && choices.join("|") === "Approve|Deny";
      ctx.dialogs.set(requestId, { uiId, method: approval ? "approval" : method });
      if (approval) {
        yield* emit(ctx, {
          type: "request.opened",
          requestId: runtimeRequestId,
          payload: {
            requestType: "dynamic_tool_call",
            detail: title.slice(0, 2_000),
            options: [
              { decision: "accept", label: "Approve" },
              { decision: "decline", label: "Deny" },
            ],
          },
        });
        return;
      }
      const labels = method === "confirm" ? ["Yes", "No"] : choices;
      yield* emit(ctx, {
        type: "user-input.requested",
        requestId: runtimeRequestId,
        payload: {
          questions: [
            {
              id: "answer",
              header: title.slice(0, 80),
              question: asString(frame.message) ?? asString(frame.placeholder) ?? title,
              options: labels.map((label) => ({ label, description: "" })),
              allowCustomAnswer: method === "input" || method === "editor",
              multiSelect: false,
            },
          ],
        },
      });
    });

  const settleDialog = (
    ctx: PiSessionContext,
    requestId: ApprovalRequestId,
    result: { readonly answers?: Record<string, unknown>; readonly decision?: string } = {},
  ) => {
    const dialog = ctx.dialogs.get(requestId);
    ctx.dialogs.delete(requestId);
    const runtimeRequestId = RuntimeRequestId.make(requestId);
    if (!dialog) return Effect.void;
    return dialog.method === "approval"
      ? emit(ctx, {
          type: "request.resolved",
          requestId: runtimeRequestId,
          payload: { requestType: "dynamic_tool_call", decision: result.decision ?? "cancel" },
        })
      : emit(ctx, {
          type: "user-input.resolved",
          requestId: runtimeRequestId,
          payload: { answers: result.answers ?? {} },
        });
  };

  const cancelDialogs = (ctx: PiSessionContext, input: { uiId?: string; notify: boolean }) =>
    Effect.forEach(
      [...ctx.dialogs].filter(([, dialog]) => !input.uiId || dialog.uiId === input.uiId),
      ([requestId, dialog]) =>
        (input.notify
          ? (ctx.rpc?.write({ type: "extension_ui_response", id: dialog.uiId, cancelled: true }) ??
            Effect.void)
          : Effect.void
        ).pipe(Effect.andThen(settleDialog(ctx, requestId))),
      { discard: true },
    );

  const answerDialog = (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    toFrame: (dialog: Dialog) => PiFrame,
    result: { readonly answers?: Record<string, unknown>; readonly decision?: string },
  ) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(threadId);
      const dialog = ctx.dialogs.get(requestId);
      if (!dialog) {
        return yield* requestError("extension_ui_response", `Unknown request: ${requestId}`);
      }
      const rpc = yield* rpcOf(ctx, "extension_ui_response");
      yield* rpc.write({ type: "extension_ui_response", id: dialog.uiId, ...toFrame(dialog) });
      yield* settleDialog(ctx, requestId, result);
    });

  const finishTurn = (ctx: PiSessionContext) =>
    Effect.gen(function* () {
      if (!ctx.turnId) return;
      yield* closeItem(ctx, "reasoning");
      yield* closeItem(ctx, "assistant");
      for (const [callId, tool] of ctx.tools) {
        yield* item(ctx, "item.completed", RuntimeItemId.make(callId), {
          itemType: tool.itemType,
          status: "failed",
          title: tool.title,
        });
      }
      ctx.tools.clear();
      yield* cancelDialogs(ctx, { notify: true });
      const aborted = ctx.interrupted || ctx.stopReason === "aborted";
      const failed = !aborted && ctx.stopReason === "error";
      yield* emit(ctx, {
        type: "turn.completed",
        payload: {
          state: aborted ? "interrupted" : failed ? "failed" : "completed",
          stopReason: aborted ? "aborted" : (ctx.stopReason ?? null),
          ...(failed && ctx.errorMessage ? { errorMessage: ctx.errorMessage } : {}),
        },
      });
      const { activeTurnId: _activeTurnId, ...ready } = ctx.session;
      ctx.session = { ...ready, status: "ready", updatedAt: yield* nowIso };
      ctx.turnId = undefined;
      ctx.interrupted = false;
      ctx.stopReason = undefined;
      ctx.errorMessage = undefined;
      yield* emit(ctx, { type: "session.state.changed", payload: { state: "ready" } });
    });

  const endSession = (ctx: PiSessionContext, reason?: string) =>
    Effect.gen(function* () {
      if (ctx.stopping) return;
      ctx.stopping = true;
      sessions.delete(ctx.threadId);
      if (reason) {
        ctx.stopReason = "error";
        ctx.errorMessage = reason.slice(0, 500);
      } else {
        ctx.interrupted = true;
      }
      yield* finishTurn(ctx);
      yield* emit(ctx, {
        type: "session.exited",
        payload: reason
          ? { reason: reason.slice(0, 500), exitKind: "error", recoverable: true }
          : { exitKind: "graceful" },
      });
      yield* Scope.close(ctx.scope, Exit.void);
    });

  const handleFrame = (ctx: PiSessionContext, frame: PiFrame): Effect.Effect<void> => {
    const type = asString(frame.type);
    if (type === flavor.settleEvent) return finishTurn(ctx);
    if (type === "extension_ui_request") {
      const target = asString(frame.targetId);
      if (frame.method !== "cancel") return openDialog(ctx, frame);
      return target ? cancelDialogs(ctx, { uiId: target, notify: false }) : Effect.void;
    }
    if (!ctx.turnId) return Effect.void;
    if (type === "message_start") {
      ctx.streamed = false;
    } else if (type === "message_update") {
      const update = asRecord(frame.assistantMessageEvent);
      const delta = asString(update.delta);
      if (delta && update.type === "text_delta") return streamDelta(ctx, "assistant", delta);
      if (delta && update.type === "thinking_delta") return streamDelta(ctx, "reasoning", delta);
    } else if (type === "message_end") {
      const message = asRecord(frame.message);
      if (message.role === "assistant") return finishAssistantMessage(ctx, message);
    } else if (type?.startsWith("tool_execution_")) {
      return handleToolFrame(ctx, frame);
    }
    return Effect.void;
  };

  const applySelection = (ctx: PiSessionContext, selection: ModelSelection | undefined) =>
    Effect.gen(function* () {
      const rpc = yield* rpcOf(ctx, "set_model");
      const slug = selection?.model;
      if (slug && slug !== PI_DEFAULT_MODEL && slug !== ctx.model) {
        const parts = splitModelSlug(slug);
        if (!parts) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "set_model",
            issue: `Model '${slug}' must look like provider/model-id.`,
          });
        }
        const response = yield* rpc.request({ type: "set_model", ...parts });
        ctx.model = slug;
        ctx.effort = undefined;
        ctx.contextWindow = Number(asRecord(response.data).contextWindow) || undefined;
      }
      const effort = getModelSelectionStringOptionValue(selection, REASONING_OPTION_ID);
      if (effort && effort !== ctx.effort) {
        yield* rpc.request({ type: "set_thinking_level", level: effort });
        ctx.effort = effort;
      }
    });

  const startSession: Shape["startSession"] = (input) =>
    Effect.gen(function* () {
      const previous = sessions.get(input.threadId);
      if (previous) yield* endSession(previous);
      const cwd = input.cwd ?? serverConfig.cwd;
      yield* fileSystem
        .makeDirectory(sessionDir, { recursive: true })
        .pipe(
          Effect.mapError(processError(input.threadId, "Failed to create the session directory.")),
        );
      const cursorFile = asString(asRecord(input.resumeCursor).sessionFile);
      const resumeFile =
        cursorFile && (yield* fileSystem.exists(cursorFile).pipe(Effect.orElseSucceed(() => false)))
          ? cursorFile
          : undefined;
      const scope = yield* Scope.make();
      const now = yield* nowIso;
      const ctx: PiSessionContext = {
        threadId: input.threadId,
        scope,
        dialogs: new Map(),
        tools: new Map(),
        open: {},
        interrupted: false,
        streamed: false,
        stopping: false,
        seq: 0,
        sessionFile: resumeFile,
        session: {
          provider: PROVIDER,
          providerInstanceId: options.instanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd,
          threadId: input.threadId,
          createdAt: now,
          updatedAt: now,
        },
      };
      const sessionId = yield* Effect.gen(function* () {
        const rpc = yield* spawnPiRpc({
          provider: PROVIDER,
          command: settings.binaryPath || flavor.binary,
          args: [
            "--mode",
            "rpc",
            "--session-dir",
            sessionDir,
            ...(resumeFile ? [flavor.resumeFlag, resumeFile] : []),
            ...flavor.approvalArgs(input.runtimeMode),
          ],
          cwd,
          env: options.environment,
          onFrame: (frame) => handleFrame(ctx, frame),
          onExit: (reason) => endSession(ctx, reason),
        }).pipe(Effect.mapError(processError(input.threadId, `Failed to start ${flavor.binary}.`)));
        ctx.rpc = rpc;
        const state = asRecord((yield* rpc.request({ type: "get_state" })).data);
        const model = asRecord(state.model);
        const provider = asString(model.provider);
        const modelId = asString(model.id);
        ctx.model = provider && modelId ? `${provider}/${modelId}` : undefined;
        ctx.contextWindow = Number(model.contextWindow) || undefined;
        ctx.sessionFile = asString(state.sessionFile) ?? ctx.sessionFile;
        yield* applySelection(ctx, input.modelSelection);
        return asString(state.sessionId);
      }).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.tapError(() => Scope.close(scope, Exit.void)),
      );
      ctx.session = {
        ...ctx.session,
        ...(ctx.model ? { model: ctx.model } : {}),
        resumeCursor: { schemaVersion: 1, sessionFile: ctx.sessionFile },
      };
      sessions.set(input.threadId, ctx);
      yield* emit(ctx, { type: "session.started", payload: { resume: ctx.session.resumeCursor } });
      yield* emit(ctx, {
        type: "thread.started",
        payload: { providerThreadId: sessionId ?? input.threadId },
      });
      yield* emit(ctx, { type: "session.state.changed", payload: { state: "ready" } });
      if (
        input.runtimeMode !== "full-access" &&
        flavor.approvalArgs(input.runtimeMode).length === 0
      ) {
        yield* emit(ctx, {
          type: "runtime.warning",
          payload: {
            message: `${flavor.displayName} has no tool approval gate, so every tool call runs without asking.`,
          },
        });
      }
      return ctx.session;
    });

  const readImages = (attachments: ProviderSendTurnInput["attachments"]) =>
    Effect.forEach(
      (attachments ?? []).filter((attachment) => attachment.type === "image"),
      (attachment) =>
        Effect.gen(function* () {
          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment,
          });
          if (!attachmentPath) {
            return yield* requestError("prompt", `Invalid attachment id '${attachment.id}'.`);
          }
          const bytes = yield* fileSystem
            .readFile(attachmentPath)
            .pipe(
              Effect.mapError((cause) =>
                requestError("prompt", `Failed to read attachment '${attachment.id}'.`, cause),
              ),
            );
          return {
            type: "image",
            data: Buffer.from(bytes).toString("base64"),
            mimeType: attachment.mimeType,
          };
        }),
    );

  const sendTurn: Shape["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(input.threadId);
      const rpc = yield* rpcOf(ctx, "prompt");
      const message = input.input?.trim() ?? "";
      const images = yield* readImages(input.attachments);
      if (!message && images.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "A turn needs text or an image.",
        });
      }
      yield* applySelection(ctx, input.modelSelection);
      const steering = ctx.turnId !== undefined;
      const turnId = ctx.turnId ?? TurnId.make(yield* uuid);
      ctx.turnId = turnId;
      ctx.session = {
        ...ctx.session,
        status: "running",
        activeTurnId: turnId,
        ...(ctx.model ? { model: ctx.model } : {}),
        updatedAt: yield* nowIso,
      };
      if (!steering) {
        yield* emit(ctx, {
          type: "turn.started",
          payload: {
            ...(ctx.model ? { model: ctx.model } : {}),
            ...(ctx.effort ? { effort: ctx.effort } : {}),
          },
        });
        yield* emit(ctx, { type: "session.state.changed", payload: { state: "running" } });
      }
      yield* rpc
        .request({
          type: "prompt",
          message,
          ...(images.length > 0 ? { images } : {}),
          ...(steering ? { streamingBehavior: "steer" } : {}),
        })
        .pipe(
          Effect.tapError((error) =>
            steering
              ? Effect.void
              : Effect.suspend(() => {
                  ctx.stopReason = "error";
                  ctx.errorMessage = error.detail;
                  return finishTurn(ctx);
                }),
          ),
        );
      return { threadId: input.threadId, turnId, resumeCursor: ctx.session.resumeCursor };
    });

  const interruptTurn: Shape["interruptTurn"] = (threadId, turnId) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(threadId);
      if (!ctx.turnId || (turnId !== undefined && turnId !== ctx.turnId)) return;
      ctx.interrupted = true;
      yield* cancelDialogs(ctx, { notify: true });
      yield* (yield* rpcOf(ctx, "abort")).request({ type: "abort" });
    });

  const respondToRequest: Shape["respondToRequest"] = (
    threadId,
    requestId,
    decision: ProviderApprovalDecision,
  ) =>
    answerDialog(
      threadId,
      requestId,
      () =>
        decision === "cancel"
          ? { cancelled: true }
          : { value: decision.startsWith("accept") ? "Approve" : "Deny" },
      { decision },
    );

  const respondToUserInput: Shape["respondToUserInput"] = (threadId, requestId, answers) =>
    answerDialog(
      threadId,
      requestId,
      (dialog) => {
        const raw = answers.answer ?? Object.values(answers)[0];
        const value = String((Array.isArray(raw) ? raw[0] : raw) ?? "");
        return dialog.method === "confirm" ? { confirmed: value === "Yes" } : { value };
      },
      { answers },
    );

  const readThread: Shape["readThread"] = (threadId) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(threadId);
      const response = yield* (yield* rpcOf(ctx, "get_messages")).request(
        { type: "get_messages" },
        60_000,
      );
      const messages = asRecord(response.data).messages;
      const turns: Array<{ id: TurnId; items: Array<unknown> }> = [];
      for (const message of Array.isArray(messages) ? messages : []) {
        const role = asRecord(message).role;
        if (role === "system") continue;
        if (role === "user" || turns.length === 0) {
          turns.push({ id: TurnId.make(`${threadId}:history:${turns.length}`), items: [] });
        }
        turns[turns.length - 1]?.items.push(message);
      }
      return { threadId, turns };
    });

  const stopAll = () =>
    Effect.forEach([...sessions.values()], (ctx) => endSession(ctx), { discard: true });

  yield* Effect.addFinalizer(() => Effect.andThen(stopAll(), PubSub.shutdown(events)));

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
    compaction: {
      type: "native",
      start: (threadId) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          yield* (yield* rpcOf(ctx, "compact")).request({ type: "compact" }, COMPACT_TIMEOUT_MS);
          yield* emit(ctx, { type: "thread.state.changed", payload: { state: "compacted" } });
        }),
    },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession: (threadId) => Effect.flatMap(requireSession(threadId), (ctx) => endSession(ctx)),
    listSessions: () =>
      Effect.sync(() => [...sessions.values()].map((ctx) => ({ ...ctx.session }))),
    hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
    readThread,
    rollbackThread: (threadId) =>
      Effect.flatMap(requireSession(threadId), () =>
        Effect.fail(
          requestError("thread/rollback", `${flavor.displayName} sessions cannot be rolled back.`),
        ),
      ),
    stopAll,
    streamEvents: Stream.fromPubSub(events),
  } satisfies Shape;
});
