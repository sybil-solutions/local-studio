import { Schema } from "effect";
import {
  COMPUTER_TAB_IDS,
  type ComputerState,
  type ComputerTab,
} from "@/features/agent/tools/types";
import { clampComputerWidth, uniqueComputerTabs } from "@/features/agent/tools/persistence";

export const SESSION_VIEW_STATE_KEY = "local-studio.agent.sessionViewState.v1";
const MAX_SESSION_VIEWS = 100;

type ViewStorage = Pick<Storage, "getItem" | "setItem">;

export type SessionViewIdentity = {
  key: string;
  aliases: string[];
};

export type SessionComputerState = Pick<ComputerState, "open" | "tab" | "tabs" | "width">;

export type SessionViewState = {
  scrollTop: number;
  stickToBottom: boolean;
  computer?: SessionComputerState;
};

const SessionComputerStateSchema = Schema.Struct({
  open: Schema.Boolean,
  tab: Schema.String,
  tabs: Schema.Array(Schema.String),
  width: Schema.Number,
});

const SessionViewStateSchema = Schema.Struct({
  scrollTop: Schema.Number,
  stickToBottom: Schema.Boolean,
  computer: Schema.optional(SessionComputerStateSchema),
});

const SessionViewStoreSchema = Schema.Struct({
  version: Schema.Literal(1),
  views: Schema.Record(Schema.String, SessionViewStateSchema),
});

const decodeSessionViews = Schema.decodeUnknownOption(SessionViewStoreSchema);

function computerTab(value: string): ComputerTab | undefined {
  return COMPUTER_TAB_IDS.find((tab) => tab === value);
}

function normalizeComputerState(
  value: typeof SessionComputerStateSchema.Type,
): SessionComputerState | undefined {
  const tab = computerTab(value.tab);
  if (!tab) return undefined;
  const tabs = uniqueComputerTabs(
    value.tabs.flatMap((item) => {
      const resolved = computerTab(item);
      return resolved ? [resolved] : [];
    }),
  );
  return {
    open: value.open,
    tab,
    tabs: tabs.includes(tab) ? tabs : uniqueComputerTabs([...tabs, tab]),
    width: clampComputerWidth(value.width),
  };
}

function normalizeView(value: typeof SessionViewStateSchema.Type): SessionViewState {
  const computer = value.computer ? normalizeComputerState(value.computer) : undefined;
  return {
    scrollTop: Math.max(0, value.scrollTop),
    stickToBottom: value.stickToBottom,
    ...(computer ? { computer } : {}),
  };
}

function loadSessionViews(storage: ViewStorage): Map<string, SessionViewState> {
  try {
    const decoded = decodeSessionViews(
      JSON.parse(storage.getItem(SESSION_VIEW_STATE_KEY) ?? "null"),
    );
    if (decoded._tag === "None") return new Map();
    return new Map(
      Object.entries(decoded.value.views).map(([key, value]) => [key, normalizeView(value)]),
    );
  } catch {
    return new Map();
  }
}

function writeSessionViews(
  storage: ViewStorage,
  views: ReadonlyMap<string, SessionViewState>,
): void {
  const entries = [...views].slice(-MAX_SESSION_VIEWS);
  try {
    storage.setItem(
      SESSION_VIEW_STATE_KEY,
      JSON.stringify({ version: 1, views: Object.fromEntries(entries) }),
    );
  } catch {}
}

export function readSessionView(
  storage: ViewStorage,
  identity: SessionViewIdentity,
): SessionViewState | null {
  const views = loadSessionViews(storage);
  return (
    views.get(identity.key) ?? identity.aliases.map((key) => views.get(key)).find(Boolean) ?? null
  );
}

export function patchSessionView(
  storage: ViewStorage,
  identity: SessionViewIdentity,
  patch: Partial<SessionViewState>,
): SessionViewState {
  const views = loadSessionViews(storage);
  const current = views.get(identity.key) ??
    identity.aliases.map((key) => views.get(key)).find(Boolean) ?? {
      scrollTop: 0,
      stickToBottom: true,
    };
  const next = normalizeView({ ...current, ...patch });
  for (const alias of identity.aliases) views.delete(alias);
  views.delete(identity.key);
  views.set(identity.key, next);
  writeSessionViews(storage, views);
  return next;
}

export function computerSessionView(computer: ComputerState): SessionComputerState {
  return {
    open: computer.open,
    tab: computer.tab,
    tabs: computer.tabs,
    width: computer.width,
  };
}
