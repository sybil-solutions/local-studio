"use client";

interface LogStreamProps {
  logs: string[];
}

export function LogStream({ logs }: LogStreamProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs uppercase tracking-widest text-foreground/40">Logs</div>
        <div className="text-xs text-foreground/30 font-mono">{logs.length} lines</div>
      </div>

      <div className="border border-foreground/10 bg-foreground/[0.02] h-96 overflow-auto">
        {logs.length > 0 ? (
          <div className="p-4 font-mono text-xs leading-relaxed">
            {logs.map((line, i) => {
              const isError = line.includes("ERROR");
              const isWarning = line.includes("WARNING");
              const isInfo = line.includes("INFO");
              
              // Extract timestamp if present
              const timestampMatch = line.match(/^(\[?[\d\-:\s\.]+\]?)/);
              const timestamp = timestampMatch ? timestampMatch[1] : "";
              const message = timestamp ? line.slice(timestamp.length).trim() : line;
              
              return (
                <div key={i} className="flex">
                  {timestamp && (
                    <span className="text-foreground/20 shrink-0 w-28">
                      {timestamp}
                    </span>
                  )}
                  <span 
                    className={`${
                      isError ? "text-(--error)" : 
                      isWarning ? "text-(--warning)" : 
                      isInfo ? "text-(--foreground)/70" : 
                      "text-foreground/50"
                    }`}
                  >
                    {message}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-foreground/20">
            -- no output --
          </div>
        )}
      </div>
    </div>
  );
}
