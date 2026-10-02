import {
  ApprovalRequestId,
  EventId,
  type ItemLifecyclePayload,
  type ModelSelection,
  PI_DEFAULT_MODEL,
  type PiAgentSettings,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
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

const ITEM_TYPE: Record<ItemKind, ItemType> = {
  assistant: "assistant_message",
  reasoning: "reasoning",
};
const DETAIL_ARGS = ["command", "path", "file_path", "pattern", "query", "url"];

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

export const makePiAdapter = Effect.fn("makePiAdapter")(function* (
  flavor: PiFlavor,
  settings: PiAgentSettings,
  options: { readonly environment: NodeJS.ProcessEnv; readonly instanceId: ProviderInstanceId },
) {
  const PROVIDER = flavor.kind;
  type Shape = ProviderAdapterShape<ProviderAdapterError>;
  const fileSystem = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const serverConfig = yield* ServerConfig;
  const uuid = Effect.orDie((yield* Crypto.Crypto).randomUUIDv4);
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, PiSessionContext>();
  const sessionDir = (yield* Path.Path).join(serverConfig.stateDir, "provider-sessions", PROVIDER);

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
  const validationError = (operation: string, issue: string) =>
    new ProviderAdapterValidationError({ provider: PROVIDER, operation, issue });
  const processError = (threadId: ThreadId, detail: string) => (cause: unknown) =>
    new ProviderAdapterProcessError({ provider: PROVIDER, threadId, detail, cause });

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<PiSessionContext, ProviderAdapterSessionNotFoundError> => {
    const ctx = sessions.get(threadId);
    return ctx && !ctx.stopping
      ? Effect.succeed(ctx)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
  };
  const rpcOf = (ctx: PiSessionContext, method: string) =>
    ctx.rpc ? Effect.succeed(ctx.rpc) : Effect.fail(requestError(method, "Session is not ready."));
  const call = (threadId: ThreadId, type: string, timeoutMs?: number) =>
    requireSession(threadId).pipe(
      Effect.flatMap((ctx) => rpcOf(ctx, type)),
      Effect.flatMap((rpc) => rpc.request({ type }, timeoutMs)),
    );

  const item = (
    ctx: PiSessionContext,
    type: "item.started" | "item.updated" | "item.completed",
    itemId: RuntimeItemId,
    payload: ItemLifecyclePayload,
  ) => emit(ctx, { type, itemId, payload });

  const closeItem = (ctx: PiSessionContext, kind: ItemKind, detail?: string) => {
    const itemId = ctx.open[kind];
    ctx.open[kind] = undefined;
    if (!itemId) return Effect.void;
    return item(ctx, "item.completed", itemId, {
      itemType: ITEM_TYPE[kind],
      status: "completed",
      ...(detail?.trim() ? { detail } : {}),
    });
  };

  const streamDelta = (ctx: PiSessionContext, kind: ItemKind, delta: string) =>
    Effect.gen(function* () {
      if (kind === "assistant") yield* closeItem(ctx, "reasoning");
      let itemId = ctx.open[kind];
      if (!itemId) {
        itemId = RuntimeItemId.make(`${ctx.turnId ?? ctx.threadId}:${kind}:${++ctx.seq}`);
        ctx.open[kind] = itemId;
        yield* item(ctx, "item.started", itemId, {
          itemType: ITEM_TYPE[kind],
          status: "inProgress",
        });
      }
      ctx.streamed = true;
      const streamKind = kind === "assistant" ? "assistant_text" : "reasoning_text";
      yield* emit(ctx, { type: "content.delta", itemId, payload: { streamKind, delta } });
    });

  const finishAssistantMessage = (ctx: PiSessionContext, message: PiFrame) =>
    Effect.gen(function* () {
      const text = textOf(message.content);
      if (!ctx.streamed && text) yield* streamDelta(ctx, "assistant", text);
      yield* closeItem(ctx, "reasoning");
      yield* closeItem(ctx, "assistant", text);
      ctx.stopReason = asString(message.stopReason);
      ctx.errorMessage = asString(message.errorMessage);
    });

  const refreshUsage = (ctx: PiSessionContext) =>
    Effect.gen(function* () {
      const stats = asRecord((yield* (yield* rpcOf(ctx, "get_session_stats")).request({ type: "get_session_stats" })).data);
      const count = (value: unknown) =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
      const context = asRecord(stats.contextUsage);
      const tokens = asRecord(stats.tokens);
      const usedTokens = count(context.tokens);
      const maxTokens = count(context.contextWindow) ?? ctx.contextWindow;
      if (usedTokens === undefined) return;
      yield* emit(ctx, {
        type: "thread.token-usage.updated",
        payload: {
          usage: {
            usedTokens,
            ...(maxTokens ? { maxTokens } : {}),
            totalProcessedTokens: count(tokens.total),
            inputTokens: count(tokens.input),
            outputTokens: count(tokens.output),
            cachedInputTokens: count(tokens.cacheRead),
            reasoningOutputTokens: count(tokens.reasoning),
            toolUses: count(stats.toolCalls),
          },
        },
      });
    }).pipe(Effect.ignore);

  const handleToolFrame = (ctx: PiSessionContext, frame: PiFrame) => {
    const callId = asString(frame.toolCallId);
    const tool = callId ? ctx.tools.get(callId) : undefined;
    if (!callId) return Effect.void;
    if (frame.type === "tool_execution_start") {
      const title = asString(frame.toolName) ?? "tool";
      const itemType = toolItemType(title);
      const args = asRecord(frame.args);
      const key = DETAIL_ARGS.find((name) => asString(args[name]));
      const detail =
        (key ? asString(args[key])?.slice(0, 500) : undefined) ?? asString(frame.intent);
      ctx.tools.set(callId, { itemType, title });
      return item(ctx, "item.started", RuntimeItemId.make(callId), {
        itemType,
        status: "inProgress",
        title,
        ...(detail ? { detail } : {}),
        data: { toolName: title, args: frame.args },
      });
    }
    if (!tool || frame.type !== "tool_execution_end") return Effect.void;
    ctx.tools.delete(callId);
    const isError = frame.isError === true;
    return item(ctx, "item.completed", RuntimeItemId.make(callId), {
      itemType: tool.itemType,
      status: isError ? "failed" : "completed",
      title: tool.title,
      data: { output: textOf(asRecord(frame.result).content).slice(0, 20_000), isError },
    });
  };

  const openDialog = (ctx: PiSessionContext, frame: PiFrame) =>
    Effect.gen(function* () {
      const uiId = asString(frame.id);
      const method = asString(frame.method);
      if (!uiId || !method || !["select", "confirm", "input", "editor"].includes(method)) return;
      const title = asString(frame.title) ?? "Input requested";
      const choices = (Array.isArray(frame.options) ? frame.options : []).filter(
        (option): option is string => typeof option === "string",
      );
      if (method === "select" && choices.join("|") === "Approve|Deny") {
        return yield* (
          ctx.rpc?.write({ type: "extension_ui_response", id: uiId, value: "Approve" }) ??
            Effect.void
        );
      }
      const requestId = ApprovalRequestId.make(yield* uuid);
      ctx.dialogs.set(requestId, { uiId, method });
      yield* emit(ctx, {
        type: "user-input.requested",
        requestId: RuntimeRequestId.make(requestId),
        payload: {
          questions: [
            {
              id: "answer",
              header: title.slice(0, 80),
              question: asString(frame.message) ?? asString(frame.placeholder) ?? title,
              options: (method === "confirm" ? ["Yes", "No"] : choices).map((label) => ({
                label,
                description: "",
              })),
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
    answers: Record<string, unknown> = {},
  ) => {
    const dialog = ctx.dialogs.get(requestId);
    ctx.dialogs.delete(requestId);
    if (!dialog) return Effect.void;
    return emit(ctx, {
      type: "user-input.resolved",
      requestId: RuntimeRequestId.make(requestId),
      payload: { answers },
    });
  };

  const cancelDialogs = (ctx: PiSessionContext, notify: boolean, uiId?: string) =>
    Effect.forEach(
      [...ctx.dialogs].filter(([, dialog]) => !uiId || dialog.uiId === uiId),
      ([requestId, dialog]) =>
        Effect.andThen(
          (notify &&
            ctx.rpc?.write({ type: "extension_ui_response", id: dialog.uiId, cancelled: true })) ||
            Effect.void,
          settleDialog(ctx, requestId),
        ),
      { discard: true },
    );

  const finishTurn = (ctx: PiSessionContext) =>
    Effect.gen(function* () {
      if (!ctx.turnId) return;
      yield* closeItem(ctx, "reasoning");
      yield* closeItem(ctx, "assistant");
      for (const [callId, tool] of ctx.tools) {
        yield* item(ctx, "item.completed", RuntimeItemId.make(callId), {
          ...tool,
          status: "failed",
        });
      }
      ctx.tools.clear();
      yield* cancelDialogs(ctx, true);
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
      ctx.turnId = ctx.stopReason = ctx.errorMessage = undefined;
      ctx.interrupted = false;
      yield* emit(ctx, { type: "session.state.changed", payload: { state: "ready" } });
    });

  const endSession = (ctx: PiSessionContext, reason?: string) =>
    Effect.gen(function* () {
      if (ctx.stopping) return;
      ctx.stopping = true;
      sessions.delete(ctx.threadId);
      ctx.interrupted = !reason;
      if (reason) ctx.stopReason = "error";
      ctx.errorMessage = reason?.slice(0, 500);
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
    if (type === flavor.settleEvent) {
      return finishTurn(ctx).pipe(Effect.andThen(Effect.forkIn(refreshUsage(ctx), ctx.scope)), Effect.asVoid);
    }
    if (type === "extension_ui_request") {
      const target = asString(frame.targetId);
      if (frame.method !== "cancel") return openDialog(ctx, frame);
      return target ? cancelDialogs(ctx, false, target) : Effect.void;
    }
    if (!ctx.turnId) return Effect.void;
    if (type === "message_start") ctx.streamed = false;
    if (type?.startsWith("tool_execution_")) return handleToolFrame(ctx, frame);
    const update = asRecord(frame.assistantMessageEvent);
    const delta = asString(update.delta);
    if (type === "message_update" && delta && update.type === "text_delta") {
      return streamDelta(ctx, "assistant", delta);
    }
    if (type === "message_update" && delta && update.type === "thinking_delta") {
      return streamDelta(ctx, "reasoning", delta);
    }
    const message = asRecord(frame.message);
    return type === "message_end" && message.role === "assistant"
      ? finishAssistantMessage(ctx, message)
      : Effect.void;
  };

  const syncState = (ctx: PiSessionContext, rpc: PiRpc) =>
    Effect.gen(function* () {
      const state = asRecord((yield* rpc.request({ type: "get_state" })).data);
      const model = asRecord(state.model);
      const provider = asString(model.provider);
      const modelId = asString(model.id);
      ctx.model = provider && modelId ? `${provider}/${modelId}` : undefined;
      ctx.contextWindow = Number(model.contextWindow) || undefined;
      ctx.effort = asString(state.thinkingLevel);
      ctx.sessionFile = asString(state.sessionFile) ?? ctx.sessionFile;
      return state;
    });

  const applySelection = (ctx: PiSessionContext, selection: ModelSelection | undefined) =>
    Effect.gen(function* () {
      const rpc = yield* rpcOf(ctx, "set_model");
      const slug = selection?.model;
      if (slug && slug !== PI_DEFAULT_MODEL && slug !== ctx.model) {
        const parts = splitModelSlug(slug);
        if (!parts) return yield* validationError("set_model", `Model '${slug}' must look like provider/model-id.`);
        yield* rpc.request({ type: "set_model", ...parts });
        ctx.effort = undefined;
      }
      const effort = getModelSelectionStringOptionValue(selection, REASONING_OPTION_ID);
      if (effort && effort !== ctx.effort) yield* rpc.request({ type: "set_thinking_level", level: effort });
      yield* syncState(ctx, rpc);
      if (effort && effort !== ctx.effort) {
        yield* emit(ctx, {
          type: "runtime.warning",
          payload: {
            message: `${flavor.displayName} applied thinking level '${ctx.effort ?? "off"}' instead of '${effort}' for '${ctx.model ?? PI_DEFAULT_MODEL}'.`,
          },
        });
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
            ...["--mode", "rpc", "--session-dir", sessionDir],
            ...(resumeFile ? [flavor.resumeFlag, resumeFile] : []),
            ...flavor.sessionArgs,
          ],
          cwd,
          env: options.environment,
          onFrame: (frame) => handleFrame(ctx, frame),
          onExit: (reason) => endSession(ctx, reason),
        }).pipe(Effect.mapError(processError(input.threadId, `Failed to start ${flavor.binary}.`)));
        ctx.rpc = rpc;
        const state = yield* syncState(ctx, rpc);
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
      yield* refreshUsage(ctx);
      return ctx.session;
    });

  const sendTurn: Shape["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const ctx = yield* requireSession(input.threadId);
      const rpc = yield* rpcOf(ctx, "prompt");
      const message = input.input?.trim() ?? "";
      const images = yield* Effect.forEach(
        (input.attachments ?? []).filter((attachment) => attachment.type === "image"),
        (attachment) =>
          Effect.gen(function* () {
            const file = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment,
            });
            if (!file)
              return yield* requestError("prompt", `Invalid attachment id '${attachment.id}'.`);
            const bytes = yield* fileSystem
              .readFile(file)
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
      if (!message && images.length === 0) {
        return yield* validationError("sendTurn", "A turn needs text or an image.");
      }
      yield* applySelection(ctx, input.modelSelection);
      const steering = ctx.turnId !== undefined;
      const turnId = ctx.turnId ?? TurnId.make(yield* uuid);
      ctx.turnId = turnId;
      const model = ctx.model ? { model: ctx.model } : {};
      ctx.session = {
        ...ctx.session,
        status: "running",
        activeTurnId: turnId,
        ...model,
        updatedAt: yield* nowIso,
      };
      if (!steering) {
        yield* emit(ctx, {
          type: "turn.started",
          payload: { ...model, ...(ctx.effort ? { effort: ctx.effort } : {}) },
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

  const readThread: Shape["readThread"] = (threadId) =>
    Effect.gen(function* () {
      const messages = asRecord((yield* call(threadId, "get_messages", 60_000)).data).messages;
      const turns: Array<{ id: TurnId; items: Array<unknown> }> = [];
      for (const message of Array.isArray(messages) ? messages : []) {
        const role = asRecord(message).role;
        if (role === "system") continue;
        if (role === "user" || turns.length === 0) {
          turns.push({ id: TurnId.make(`${threadId}:history:${turns.length}`), items: [] });
        }
        turns.at(-1)?.items.push(message);
      }
      yield* Effect.flatMap(requireSession(threadId), refreshUsage).pipe(Effect.ignore);
      return { threadId, turns };
    });

  const rollbackThread: Shape["rollbackThread"] = (threadId, numTurns) =>
    Effect.gen(function* () {
      const fail = (detail: string) => requestError("thread/rollback", detail);
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        return yield* validationError("rollbackThread", "numTurns must be an integer >= 1.");
      }
      const ctx = yield* requireSession(threadId);
      const rpc = yield* rpcOf(ctx, "thread/rollback");
      const state = asRecord((yield* rpc.request({ type: "get_state" })).data);
      if (ctx.turnId || state.isStreaming === true || state.isCompacting === true) {
        return yield* fail("Wait for the active turn to settle before rolling back.");
      }
      const history = asRecord((yield* rpc.request({ type: "get_entries" }, 60_000)).data);
      if (!Array.isArray(history.entries)) return yield* fail("Session entries are unavailable.");
      const entries = new Map(history.entries.map((raw) => [asString(asRecord(raw).id), asRecord(raw)]));
      const users: string[] = [];
      const visited = new Set<string>();
      for (let id = asString(history.leafId); id; id = asString(entries.get(id)?.parentId)) {
        const entry = entries.get(id);
        if (!entry || visited.has(id)) return yield* fail("Invalid session ancestry.");
        visited.add(id);
        if (entry.type === "message" && asRecord(entry.message).role === "user") users.push(id);
      }
      const entryId = users[Math.min(numTurns, users.length) - 1];
      if (!entryId) return yield* readThread(threadId);
      const result = asRecord((yield* rpc.request({ type: flavor.rollbackCommand, entryId }, 60_000)).data);
      if (result.cancelled !== false) return yield* fail("Conversation rollback was cancelled or not confirmed.");
      const previous = ctx.sessionFile;
      ctx.sessionFile = undefined;
      yield* syncState(ctx, rpc);
      if (!ctx.sessionFile) {
        ctx.sessionFile = previous;
        return yield* fail("The rolled-back session file is unavailable.");
      }
      ctx.session = {
        ...ctx.session,
        ...(ctx.model ? { model: ctx.model } : {}),
        resumeCursor: { schemaVersion: 1, sessionFile: ctx.sessionFile },
        updatedAt: yield* nowIso,
      };
      yield* emit(ctx, { type: "session.started", payload: { resume: ctx.session.resumeCursor } });
      return yield* readThread(threadId);
    });

  const stopAll = () =>
    Effect.forEach([...sessions.values()], (ctx) => endSession(ctx), { discard: true });
  yield* Effect.addFinalizer(() => Effect.andThen(stopAll(), PubSub.shutdown(events)));

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: true },
    compaction: {
      type: "native",
      start: (threadId) =>
        call(threadId, "compact", 300_000).pipe(
          Effect.andThen(requireSession(threadId)),
          Effect.tap(refreshUsage),
          Effect.flatMap((ctx) =>
            emit(ctx, { type: "thread.state.changed", payload: { state: "compacted" } }),
          ),
        ),
    },
    startSession,
    sendTurn,
    interruptTurn: (threadId, turnId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (!ctx.turnId || (turnId !== undefined && turnId !== ctx.turnId)) return;
        ctx.interrupted = true;
        yield* cancelDialogs(ctx, true);
        yield* call(threadId, "abort");
      }),
    respondToRequest: () =>
      Effect.fail(
        requestError("respondToRequest", `${flavor.displayName} has no tool approval gate.`),
      ),
    respondToUserInput: (threadId, requestId, answers) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const dialog = ctx.dialogs.get(requestId);
        if (!dialog)
          return yield* requestError("extension_ui_response", `Unknown request: ${requestId}`);
        const raw = answers.answer ?? Object.values(answers)[0];
        const value = String((Array.isArray(raw) ? raw[0] : raw) ?? "");
        yield* (yield* rpcOf(ctx, "extension_ui_response")).write({
          type: "extension_ui_response",
          id: dialog.uiId,
          ...(dialog.method === "confirm" ? { confirmed: value === "Yes" } : { value }),
        });
        yield* settleDialog(ctx, requestId, answers);
      }),
    stopSession: (threadId) => Effect.flatMap(requireSession(threadId), (ctx) => endSession(ctx)),
    listSessions: () =>
      Effect.sync(() => [...sessions.values()].map((ctx) => ({ ...ctx.session }))),
    hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromPubSub(events),
  } satisfies Shape;
});
