export function AgentEmptyPrompt() {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto bg-(--agent-bg) px-6 pb-10 pt-2">
      <div className="agent-thread-shell mx-auto flex flex-1">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-[length:var(--fs-2xl)] font-medium tracking-[-0.015em] text-(--fg)/90">
            Start a task
          </p>
          <p className="text-[length:var(--fs-sm)] text-(--dim)">
            Describe what you want to build or change.
          </p>
        </div>
      </div>
    </div>
  );
}
