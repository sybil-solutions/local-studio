// CRITICAL
"use client";

import { useMemo, useState } from "react";
import { X, Settings } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { DeepResearchConfig } from "@/lib/types";
import type { ModelOption } from "../../types";
import { parseChatModelId } from "../../types";

interface ChatSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string;
  onSystemPromptChange: (prompt: string) => void;
  selectedModel: string;
  onSelectedModelChange: (model: string) => void;
  availableModels: ModelOption[];
  customChatModels: string[];
  onAddCustomChatModel: (model: string) => void;
  onRemoveCustomChatModel: (model: string) => void;
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
  customChatModels,
  onAddCustomChatModel,
  onRemoveCustomChatModel,
  deepResearch,
  onDeepResearchChange,
}: ChatSettingsModalProps) {
  const [newCustomModel, setNewCustomModel] = useState("");
  const [customModelError, setCustomModelError] = useState("");

  const normalizedCustomModels = useMemo(
    () =>
      Array.from(
        new Set(
          customChatModels
            .map((model) => model.trim())
            .filter((model) => model.length > 0),
        ),
      ),
    [customChatModels],
  );

  const isDuplicate = normalizedCustomModels.includes(newCustomModel.trim());
  const availableByDisplayId = useMemo(
    () =>
      new Set(
        availableModels.flatMap((model) => {
          const parsed = parseChatModelId(model.id);
          return [model.id, parsed.id];
        }),
      ),
    [availableModels],
  );

  const handleAddCustomModel = () => {
    const selected = newCustomModel.trim();
    if (!selected) {
      setCustomModelError("Model id is required.");
      return;
    }
    if (isDuplicate || availableByDisplayId.has(selected)) {
      setCustomModelError("This model is already in your list.");
      return;
    }
    onAddCustomChatModel(selected);
    setNewCustomModel("");
    setCustomModelError("");
  };

  const handleCustomModelKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddCustomModel();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        className="absolute inset-0 z-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative z-10 w-full max-w-lg mx-4 bg-(--card) border border-(--border) rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-(--border)">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-[#9a9590]" />
            <h2 className="text-lg font-semibold">Chat Settings</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-(--accent)">
            <X className="h-5 w-5 text-[#9a9590]" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-[#c8c4bd] mb-2">Model</label>
            <select
              value={selectedModel}
              onChange={(e) => onSelectedModelChange(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-(--border) rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-(--link)/50"
            >
              <option value="">Select a model</option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name ?? model.id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#c8c4bd] mb-2">System Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              rows={4}
              placeholder="Enter a system prompt..."
              className="w-full px-3 py-2 bg-background border border-(--border) rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-(--link)/50"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deepResearch.enabled}
                onChange={(e) => onDeepResearchChange({ ...deepResearch, enabled: e.target.checked })}
                className="w-4 h-4 rounded border-(--border) bg-background"
              />
              <span className="text-sm font-medium text-[#c8c4bd]">Enable Deep Research</span>
            </label>
            <p className="text-xs text-[#6a6560] mt-1 ml-6">
              Uses web search to gather context before responding
            </p>
          </div>

          <div className="border-t border-(--border) pt-4">
            <label className="block text-sm font-medium text-[#c8c4bd] mb-2">Custom Models</label>
            <p className="text-xs text-[#6a6560] mb-3">
              Add custom OpenAI-compatible model IDs for the chat model selector (example: provider/model-name).
            </p>

            <div className="flex gap-2">
              <input
                value={newCustomModel}
                onChange={(event) => {
                  setNewCustomModel(event.target.value);
                  setCustomModelError("");
                }}
                onKeyDown={handleCustomModelKeyDown}
                placeholder="provider/model"
                className="w-full px-3 py-2 bg-background border border-(--border) rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-(--link)/50"
              />
              <button
                type="button"
                onClick={handleAddCustomModel}
                className="px-3 py-2 rounded-lg border border-(--border) bg-(--card-hover) hover:bg-white/5 text-sm whitespace-nowrap"
              >
                Add
              </button>
            </div>
            {customModelError && <p className="text-xs text-red-400 mt-2">{customModelError}</p>}

            <ul className="mt-3 space-y-2 max-h-40 overflow-y-auto pr-1">
              {normalizedCustomModels.length === 0 ? (
                <li className="text-xs text-[#7a766f]">No custom models configured.</li>
              ) : (
                normalizedCustomModels.map((model) => (
                  <li
                    key={model}
                    className="text-xs text-[#e8e4dd] flex items-center justify-between gap-2 px-2 py-1 border border-white/10 rounded-md bg-white/5"
                  >
                    <span className="truncate">{model}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveCustomChatModel(model)}
                      className="text-[#f28b82] hover:text-red-300 text-xs"
                      title={`Remove ${model}`}
                    >
                      Remove
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
