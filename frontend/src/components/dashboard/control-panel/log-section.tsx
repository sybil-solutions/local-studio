// CRITICAL
"use client";

interface LogSectionProps {
  logs: string[];
}

export function LogSection({ logs }: LogSectionProps) {
  return (
    <div className="border border-(--border) bg-(--surface)">
      <div className="flex items-center justify-between border-b border-(--border) px-3 py-2">
        <span className="text-sm font-semibold leading-5 text-(--fg)">Logs</span>
        <span className="font-mono text-[10px] tabular-nums text-(--dim)">{logs.length} lines</span>
      </div>
      <div className="h-72 overflow-auto bg-(--bg)">
        {logs.length > 0 ? (
          <pre className="m-0 whitespace-pre-wrap break-normal px-3 py-2.5 font-mono text-[11px] leading-[1.45] text-(--dim)">
            {logs.map((line, i) => {
              const isError = line.includes("ERROR");
              const isWarning = line.includes("WARNING");
              return (
                <span
                  key={i}
                  className={`block ${
                    isError ? "text-(--err)" : isWarning ? "text-(--fg)/80" : "text-(--dim)"
                  }`}
                >
                  {line}
                </span>
              );
            })}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-xs text-(--dim)">
            No output
          </div>
        )}
      </div>
    </div>
  );
}
