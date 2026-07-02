"use client";

import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { effectInterval } from "@/lib/effect-timers";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  CheckCircle2,
  Circle,
  CircleDot,
  MessageSquarePlus,
  SquarePen,
  XCircle,
} from "@/ui/icon-registry";
import {
  nextStatus,
  parsePlanTodos,
  planProgress,
  setTodoStatusAtLine,
  type PlanTodo,
  type PlanTodoStatus,
} from "@/features/agent/plan-parser";

const PLACEHOLDER = `### To-dos
- [ ] First task
- [ ] Second task
`;

function planQuery(sessionId: string | null): string {
  return sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
}

const STATUS_META: Record<
  PlanTodoStatus,
  { icon: typeof Circle; className: string; pillClassName: string; label: string }
> = {
  pending: {
    icon: Circle,
    className: "text-(--dim)/70",
    pillClassName: "border-(--border) text-(--dim)",
    label: "Pending",
  },
  in_progress: {
    icon: CircleDot,
    className: "text-(--accent)/80",
    pillClassName: "border-(--accent)/25 bg-(--accent)/8 text-(--accent)",
    label: "In progress",
  },
  completed: {
    icon: CheckCircle2,
    className: "text-(--accent)",
    pillClassName: "border-(--accent)/25 bg-(--accent)/8 text-(--accent)",
    label: "Done",
  },
  cancelled: {
    icon: XCircle,
    className: "text-(--dim)/50",
    pillClassName: "border-(--border) text-(--dim)/70",
    label: "Cancelled",
  },
};

type PlanView = "list" | "raw";

export function PlanPanel({
  sessionId,
  onOpenTaskSideChat,
}: {
  sessionId: string | null;
  onOpenTaskSideChat?: (todo: PlanTodo) => void;
}) {
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<PlanView>("list");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = view === "raw";

  usePlanDocument({ sessionId, editing, setMarkdown, setLoading });

  // Cancel a pending debounced save on unmount so it can't fire a post-unmount POST.
  useMountSubscription(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const persist = useCallback(
    (value: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void fetch(`/api/agent/plan${planQuery(sessionId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown: value }),
        }).catch(() => undefined);
      }, 400);
    },
    [sessionId],
  );

  const updateMarkdown = useCallback(
    (value: string) => {
      setMarkdown(value);
      persist(value);
    },
    [persist],
  );

  const todos = useMemo(() => parsePlanTodos(markdown), [markdown]);
  const { done, total } = useMemo(() => planProgress(todos), [todos]);
  const percent = total ? Math.round((done / total) * 100) : 0;

  const cycleTodo = useCallback(
    (todo: PlanTodo) => {
      updateMarkdown(setTodoStatusAtLine(markdown, todo.lineIndex, nextStatus(todo.status)));
    },
    [markdown, updateMarkdown],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-(--color-panel)">
      <div className="flex shrink-0 flex-col gap-3 border-b border-(--border) px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[length:var(--fs-md)] font-semibold text-(--fg)">
                Plan
              </h2>
              {total > 0 ? (
                <span className="rounded border border-(--border) bg-(--surface) px-1.5 py-0.5 font-mono text-[length:var(--fs-xs)] text-(--dim)">
                  {done}/{total}
                </span>
              ) : null}
            </div>
            <p className="truncate text-[length:var(--fs-sm)] text-(--dim)">
              Checklist with raw markdown editing.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-(--border) bg-(--surface) p-0.5">
            <PlanViewButton active={view === "list"} onClick={() => setView("list")}>
              List
            </PlanViewButton>
            <PlanViewButton active={view === "raw"} onClick={() => setView("raw")}>
              Raw
            </PlanViewButton>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-(--surface)">
            <div
              className="h-full rounded-full bg-(--accent)/75 transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="w-10 text-right font-mono text-[length:var(--fs-xs)] text-(--dim)">
            {percent}%
          </span>
        </div>
      </div>

      {view === "raw" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-(--border) px-3 text-[length:var(--fs-sm)] text-(--dim)">
            <SquarePen className="h-3.5 w-3.5" />
            Edit the plan source. Checkbox lines become tasks in List view.
          </div>
          <textarea
            value={markdown}
            onChange={(event) => updateMarkdown(event.target.value)}
            placeholder={PLACEHOLDER}
            className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[length:var(--fs-md)] leading-6 text-(--fg) outline-none placeholder:text-(--dim)"
            spellCheck={false}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <p className="px-2 py-3 text-[length:var(--fs-sm)] text-(--dim)">Loading plan…</p>
          ) : todos.length === 0 ? (
            <div className="m-2 rounded-lg border border-dashed border-(--border) bg-(--surface)/45 p-4">
              <p className="text-[length:var(--fs-md)] font-medium text-(--fg)">No tasks yet</p>
              <p className="mt-1 text-[length:var(--fs-sm)] leading-5 text-(--dim)">
                Ask the agent to make a plan, or switch to Raw and add checkbox lines like{" "}
                <span className="font-mono text-(--fg)/75">- [ ] task</span>.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {todos.map((todo, index) => (
                <PlanTodoRow
                  key={todo.id}
                  index={index}
                  todo={todo}
                  onCycle={cycleTodo}
                  onOpenSideChat={onOpenTaskSideChat}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function PlanViewButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 text-[length:var(--fs-sm)] transition-colors ${
        active ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:text-(--fg)"
      }`}
    >
      {children}
    </button>
  );
}

function PlanTodoRow({
  index,
  todo,
  onCycle,
  onOpenSideChat,
}: {
  index: number;
  todo: PlanTodo;
  onCycle: (todo: PlanTodo) => void;
  onOpenSideChat?: (todo: PlanTodo) => void;
}) {
  const meta = STATUS_META[todo.status];
  const Icon = meta.icon;
  return (
    <li className="group rounded-lg border border-(--border) bg-(--surface)/55 transition-colors hover:border-(--fg)/15 hover:bg-(--hover)">
      <div className="flex items-start gap-2 px-2.5 py-2.5">
        <button
          type="button"
          onClick={() => onCycle(todo)}
          className="mt-0.5 rounded p-0.5 hover:bg-(--surface)"
          title={`${meta.label} — click to change`}
          aria-label={`${meta.label} — click to change`}
        >
          <Icon className={`h-4 w-4 ${meta.className}`} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[length:var(--fs-xs)] text-(--dim)">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] ${meta.pillClassName}`}
            >
              {meta.label}
            </span>
          </div>
          <p
            className={`mt-1.5 break-words text-[length:var(--fs-md)] leading-5 ${
              todo.status === "completed"
                ? "text-(--dim) line-through"
                : todo.status === "cancelled"
                  ? "text-(--dim)/60 line-through"
                  : "text-(--fg)/90"
            }`}
          >
            {todo.content || <span className="text-(--dim)">(empty task)</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenSideChat?.(todo)}
          disabled={!onOpenSideChat}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-(--dim) opacity-0 transition-opacity hover:border-(--border) hover:bg-(--surface) hover:text-(--fg) disabled:pointer-events-none group-hover:opacity-100 focus:opacity-100"
          title="Open this task in a new side chat"
          aria-label="Open this task in a new side chat"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

// Fetch the per-session plan document whenever the session changes.
function usePlanDocument({
  sessionId,
  editing,
  setMarkdown,
  setLoading,
}: {
  sessionId: string | null;
  editing: boolean;
  setMarkdown: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
}): void {
  useMountSubscription(() => {
    let cancelled = false;
    const load = (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      fetch(`/api/agent/plan${planQuery(sessionId)}`, { cache: "no-store" })
        .then((res) =>
          res.ok
            ? (res.json() as Promise<{ markdown?: string }>)
            : Promise.reject(new Error("Plan fetch failed")),
        )
        .then((payload) => {
          if (cancelled || editing) return;
          const next = typeof payload.markdown === "string" ? payload.markdown : "";
          setMarkdown((current) => (current === next ? current : next));
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled && showLoading) setLoading(false);
        });
    };
    load(true);
    const poll = editing ? null : effectInterval(() => load(false), 1500);
    return () => {
      cancelled = true;
      poll?.cancel();
    };
  }, [editing, sessionId, setMarkdown, setLoading]);
}
