// CRITICAL
"use client";

import type { CompatibilityCheck, CompatibilityReport } from "@/lib/types";

const sortSeverity = (severity: CompatibilityCheck["severity"]): number => {
  if (severity === "error") return 0;
  if (severity === "warn") return 1;
  return 2;
};

const titleForSeverity = (severity: CompatibilityCheck["severity"]): string => {
  if (severity === "error") return "Errors";
  if (severity === "warn") return "Warnings";
  return "Info";
};

export function CompatibilityPanel({ report }: { report: CompatibilityReport | null }) {
  const checks = report?.checks ?? [];
  const grouped = new Map<CompatibilityCheck["severity"], CompatibilityCheck[]>();

  for (const check of checks) {
    const list = grouped.get(check.severity) ?? [];
    list.push(check);
    grouped.set(check.severity, list);
  }

  const severities = Array.from(grouped.keys()).sort((a, b) => sortSeverity(a) - sortSeverity(b));

  return (
    <div className="bg-(--surface) rounded-lg p-4 border border-(--border)">
      <div className="text-xs text-(--dim) uppercase tracking-wider mb-3">Compatibility</div>
      {!report && <div className="text-sm text-(--dim)">No report available.</div>}
      {report && checks.length === 0 && <div className="text-sm text-(--dim)">No issues detected.</div>}

      {report &&
        severities.map((severity) => (
          <div key={severity} className="space-y-3 mb-4 last:mb-0">
            <div className="text-xs uppercase tracking-wider text-(--dim)">
              {titleForSeverity(severity)}
            </div>
            <div className="space-y-3">
              {(grouped.get(severity) ?? []).map((check) => (
                <div key={check.id} className="rounded-md border border-(--border) bg-(--surface) p-3">
                  <div className="text-sm text-(--fg)">{check.message}</div>
                  {check.evidence && (
                    <pre className="mt-2 text-xs text-(--dim) whitespace-pre-wrap font-mono">
                      {check.evidence}
                    </pre>
                  )}
                  {check.suggested_fix && (
                    <pre className="mt-2 text-xs whitespace-pre-wrap font-mono text-(--fg)">
                      {check.suggested_fix}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
