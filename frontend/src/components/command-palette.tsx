'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';

export type CommandPaletteAction = {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
};

export function CommandPalette({
  open,
  onClose,
  actions,
  statusText,
}: {
  open: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
  statusText?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => {
      const hay = [a.label, a.hint, ...(a.keywords || [])].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [actions, query]);

  const runActive = async () => {
    const action = filtered[activeIndex];
    if (!action) return;
    try {
      await action.run();
    } finally {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 bg-black/60" onMouseDown={onClose}>
      <div
        className="w-full max-w-xl bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--card)]">
          <Search className="h-4 w-4 text-[#9a9590]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands…"
            className="flex-1 bg-transparent outline-none text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                runActive();
              }
            }}
          />
          <div className="flex items-center gap-1 text-[10px] text-[#9a9590]">
            <CornerDownLeft className="h-3 w-3" />
            Enter
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-sm text-[#9a9590]">No matching commands.</div>
          ) : (
            filtered.map((a, idx) => (
              <button
                key={a.id}
                onClick={() => {
                  setActiveIndex(idx);
                  runActive();
                }}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`w-full text-left px-4 py-3 border-t border-[var(--border)] first:border-t-0 ${
                  idx === activeIndex ? 'bg-[var(--card-hover)]' : 'hover:bg-[var(--card-hover)]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{a.label}</div>
                    {a.hint && <div className="text-xs text-[#9a9590] truncate">{a.hint}</div>}
                  </div>
                  <div className="text-[10px] text-[#9a9590] font-mono flex-shrink-0">{a.id}</div>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-[var(--border)] text-xs text-[#9a9590] flex items-center justify-between">
          <span>{statusText || 'Ctrl/⌘K to open'}</span>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--accent)] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
