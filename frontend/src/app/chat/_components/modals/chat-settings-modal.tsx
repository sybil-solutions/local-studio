// CRITICAL
"use client";

import { X, Settings } from "lucide-react";
import type { DeepResearchConfig } from "@/lib/types";
import type { ModelOption } from "../../types";

interface ChatSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string;
  onSystemPromptChange: (prompt: string) => void;
  selectedModel: string;
  onSelectedModelChange: (model: string) => void;
  availableModels: ModelOption[];
  deepResearch: DeepResearchConfig;
  onDeepResearchChange: (config: DeepResearchConfig) => void;
}

export function ChatSettingsModal({
  isOpen,
  onClose,
  systemPrompt,
  onSystemPromptChange,
  selectedModel,
  onSelectedModelChange,
  availableModels,
  deepResearch,
  onDeepResearchChange,
}: ChatSettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative w-full max-w-lg mx-4 bg-(--card) border border-(--border) rounded-xl shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--border)">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-[#9a9590]" />
            <h2 className="text-lg font-semibold">Chat Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-(--accent)"
          >
            <X className="h-5 w-5 text-[#9a9590]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Model Selection */}
          <div>
            <label className="block text-sm font-medium text-[#c8c4bd] mb-2">
              Model
            </label>
            <select
              value={selectedModel}
              onChange={(e) => onSelectedModelChange(e.target.value)}
              className="w-full px-3 py-2 bg-(--background) border border-(--border) rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-(--link)/50"
            >
              <option value="">Select a model</option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                </option>
              ))}
            </select>
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-sm font-medium text-[#c8c4bd] mb-2">
              System Prompt
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              rows={4}
              placeholder="Enter a system prompt..."
              className="w-full px-3 py-2 bg-(--background) border border-(--border) rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-(--link)/50"
            />
          </div>

          {/* Deep Research */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deepResearch.enabled}
                onChange={(e) =>
                  onDeepResearchChange({ ...deepResearch, enabled: e.target.checked })
                }
                className="w-4 h-4 rounded border-(--border) bg-(--background)"
              />
              <span className="text-sm font-medium text-[#c8c4bd]">
                Enable Deep Research
              </span>
            </label>
            <p className="text-xs text-[#6a6560] mt-1 ml-6">
              Uses web search to gather context before responding
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
