'use client';

import { X, BarChart3, Download } from 'lucide-react';

interface SessionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd?: number | null;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  request_total_input_tokens?: number | null;
  request_prompt_tokens?: number | null;
  request_completion_tokens?: number | null;
}

// Usage Details Modal
interface UsageModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionUsage: SessionUsage | null;
  messages: Message[];
  selectedModel?: string;
}

export function UsageModal({ isOpen, onClose, sessionUsage, messages, selectedModel }: UsageModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#9a9590]" />
            <h2 className="font-medium">Usage</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--accent)] transition-colors"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="bg-[var(--background)] rounded-lg p-3">
              <div className="text-xs text-[#9a9590]">Input</div>
              <div className="text-lg font-mono font-semibold">
                {(sessionUsage?.prompt_tokens ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-[var(--background)] rounded-lg p-3">
              <div className="text-xs text-[#9a9590]">Output</div>
              <div className="text-lg font-mono font-semibold">
                {(sessionUsage?.completion_tokens ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-[var(--background)] rounded-lg p-3">
              <div className="text-xs text-[#9a9590]">Total</div>
              <div className="text-lg font-mono font-semibold">
                {(sessionUsage?.total_tokens ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-[var(--background)] rounded-lg p-3">
              <div className="text-xs text-[#9a9590]">Cost</div>
              <div className="text-lg font-mono font-semibold">
                {sessionUsage?.estimated_cost_usd != null ? `$${sessionUsage.estimated_cost_usd.toFixed(4)}` : '--'}
              </div>
            </div>
          </div>

          <div className="text-xs text-[#9a9590]">
            Request-level token accounting is stored on assistant turns when available.
          </div>

          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-[var(--accent)] text-xs font-medium text-[#b0a8a0]">
              Recent assistant turns
            </div>
            <div className="max-h-64 overflow-y-auto">
              {messages
                .filter((m) => m.role === 'assistant')
                .slice(-20)
                .reverse()
                .map((m) => {
                  const inTok = (m.request_total_input_tokens ?? m.request_prompt_tokens ?? null) as number | null;
                  const outTok = (m.request_completion_tokens ?? null) as number | null;
                  const total = (inTok || 0) + (outTok || 0);
                  return (
                    <div key={m.id} className="px-3 py-2 border-t border-[var(--border)] flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-[#9a9590] font-mono truncate">
                          {m.model || selectedModel || 'assistant'} • {m.id}
                        </div>
                        <div className="text-xs text-[#b0a8a0] truncate">
                          {(m.content || '').replace(/\s+/g, ' ').slice(0, 80)}
                        </div>
                      </div>
                      <div className="text-[10px] font-mono text-[#9a9590] text-right">
                        {total ? `${total.toLocaleString()} tok` : '--'}
                      </div>
                    </div>
                  );
                })}
              {messages.filter((m) => m.role === 'assistant').length === 0 && (
                <div className="px-3 py-4 text-sm text-[#9a9590]">No assistant messages yet.</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm border border-[var(--border)] rounded hover:bg-[var(--accent)] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Export Modal
interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportMarkdown: () => void;
  onExportJson: () => void;
}

export function ExportModal({ isOpen, onClose, onExportMarkdown, onExportJson }: ExportModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg w-full max-w-lg overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-[#9a9590]" />
            <h2 className="font-medium">Export chat</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--accent)] transition-colors" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-xs text-[#9a9590]">
            Exports use the current UI state (including tool calls/results if present).
          </div>
          <button
            onClick={() => {
              onExportMarkdown();
              onClose();
            }}
            className="w-full px-3 py-2 text-sm bg-[var(--foreground)] text-[var(--background)] rounded hover:opacity-90"
          >
            Download Markdown
          </button>
          <button
            onClick={() => {
              onExportJson();
              onClose();
            }}
            className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded hover:bg-[var(--accent)]"
          >
            Download JSON
          </button>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm border border-[var(--border)] rounded hover:bg-[var(--accent)] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
