// CRITICAL
"use client";

import { X, BarChart3 } from "lucide-react";
import type { SessionUsage } from "@/lib/types";
import type { UIMessage } from "@ai-sdk/react";

interface UsageModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionUsage: SessionUsage | null;
  messages: UIMessage[];
  selectedModel: string;
}

export function UsageModal({
  isOpen,
  onClose,
  sessionUsage,
  messages,
  selectedModel,
}: UsageModalProps) {
  if (!isOpen) return null;

  const formatNumber = (n: number) => n.toLocaleString();
  const formatCost = (cost?: number | null) =>
    cost != null ? `$${cost.toFixed(4)}` : "-";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative w-full max-w-md mx-4 bg-(--card) border border-(--border) rounded-xl shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--border)">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-[#9a9590]" />
            <h2 className="text-lg font-semibold">Session Usage</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-(--accent)"
          >
            <X className="h-5 w-5 text-[#9a9590]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {sessionUsage ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-(--background) border border-(--border) rounded-lg">
                  <div className="text-xs text-[#6a6560] uppercase tracking-wide mb-1">
                    Prompt Tokens
                  </div>
                  <div className="text-xl font-semibold">
                    {formatNumber(sessionUsage.prompt_tokens)}
                  </div>
                </div>
                <div className="p-4 bg-(--background) border border-(--border) rounded-lg">
                  <div className="text-xs text-[#6a6560] uppercase tracking-wide mb-1">
                    Completion Tokens
                  </div>
                  <div className="text-xl font-semibold">
                    {formatNumber(sessionUsage.completion_tokens)}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-(--background) border border-(--border) rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-[#6a6560] uppercase tracking-wide mb-1">
                      Total Tokens
                    </div>
                    <div className="text-2xl font-semibold">
                      {formatNumber(sessionUsage.total_tokens)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-[#6a6560] uppercase tracking-wide mb-1">
                      Estimated Cost
                    </div>
                    <div className="text-xl font-semibold text-(--link)">
                      {formatCost(sessionUsage.estimated_cost)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-xs text-[#6a6560]">
                Model: {selectedModel || "Unknown"}
                <br />
                Messages: {messages.length}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-[#6a6560]">
              <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No usage data available</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
