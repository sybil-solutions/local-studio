'use client';

import { useState, useEffect } from 'react';
import { X, Settings, Trash2, Info, Search, Globe, Zap, FileText, BookOpen, Sparkles, Brain } from 'lucide-react';

export interface DeepResearchSettings {
  enabled: boolean;
  numSources: number;
  autoSummarize: boolean;
  includeCitations: boolean;
  searchDepth: 'quick' | 'normal' | 'thorough';
}

interface ChatSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string;
  onSystemPromptChange: (prompt: string) => void;
  availableModels?: Array<{ id: string }>;
  selectedModel?: string;
  onSelectedModelChange?: (modelId: string) => void;
  onForkModels?: (modelIds: string[]) => void;
  // Deep Research settings
  deepResearch?: DeepResearchSettings;
  onDeepResearchChange?: (settings: DeepResearchSettings) => void;
}

const STORAGE_KEY = 'vllm-studio-system-prompt';

const DEFAULT_DEEP_RESEARCH: DeepResearchSettings = {
  enabled: false,
  numSources: 5,
  autoSummarize: true,
  includeCitations: true,
  searchDepth: 'normal',
};

export function ChatSettingsModal({
  isOpen,
  onClose,
  systemPrompt,
  onSystemPromptChange,
  availableModels = [],
  selectedModel = '',
  onSelectedModelChange,
  onForkModels,
  deepResearch = DEFAULT_DEEP_RESEARCH,
  onDeepResearchChange,
}: ChatSettingsModalProps) {
  const [localPrompt, setLocalPrompt] = useState(systemPrompt);
  const [forkSelection, setForkSelection] = useState<Record<string, boolean>>({});
  const [localDeepResearch, setLocalDeepResearch] = useState(deepResearch);

  useEffect(() => {
    setLocalPrompt(systemPrompt);
  }, [systemPrompt]);

  useEffect(() => {
    setLocalDeepResearch(deepResearch);
  }, [deepResearch]);

  useEffect(() => {
    // Load from localStorage on mount
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && !systemPrompt) {
      onSystemPromptChange(saved);
    }
  }, []);

  if (!isOpen) return null;

  const handleSave = () => {
    onSystemPromptChange(localPrompt);
    localStorage.setItem(STORAGE_KEY, localPrompt);
    if (onDeepResearchChange) {
      onDeepResearchChange(localDeepResearch);
      localStorage.setItem('vllm-studio-deep-research', JSON.stringify(localDeepResearch));
    }
    onClose();
  };

  const updateDeepResearch = (updates: Partial<DeepResearchSettings>) => {
    setLocalDeepResearch(prev => ({ ...prev, ...updates }));
  };

  const handleClear = () => {
    setLocalPrompt('');
  };

  const toggleForkModel = (id: string) => {
    setForkSelection((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const forkSelected = () => {
    if (!onForkModels) return;
    const selected = Object.entries(forkSelection)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .filter((id) => id && id !== selectedModel);
    if (selected.length === 0) return;
    onForkModels(selected);
    setForkSelection({});
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[#9a9590]" />
            <h2 className="font-medium">Chat Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--accent)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Deep Research Section - Featured at top */}
          {onDeepResearchChange && (
            <div className="space-y-3 p-4 bg-gradient-to-br from-blue-500/5 to-purple-500/5 border border-blue-500/20 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-blue-500/10 rounded-lg">
                    <Brain className="h-4 w-4 text-blue-400" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Deep Research Mode</label>
                    <p className="text-[10px] text-[#9a9590]">Multi-step web research with source synthesis</p>
                  </div>
                </div>
                <button
                  onClick={() => updateDeepResearch({ enabled: !localDeepResearch.enabled })}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    localDeepResearch.enabled ? 'bg-blue-500' : 'bg-[var(--border)]'
                  }`}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    localDeepResearch.enabled ? 'left-6' : 'left-1'
                  }`} />
                </button>
              </div>

              {localDeepResearch.enabled && (
                <div className="space-y-3 pt-2 border-t border-[var(--border)]">
                  {/* Search Depth */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[#b0a8a0]">Research Depth</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['quick', 'normal', 'thorough'] as const).map((depth) => (
                        <button
                          key={depth}
                          onClick={() => updateDeepResearch({ searchDepth: depth })}
                          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                            localDeepResearch.searchDepth === depth
                              ? 'bg-blue-500/10 border-blue-500/40 text-blue-400'
                              : 'border-[var(--border)] hover:bg-[var(--accent)]'
                          }`}
                        >
                          {depth === 'quick' && <Zap className="h-3 w-3 inline mr-1" />}
                          {depth === 'normal' && <Search className="h-3 w-3 inline mr-1" />}
                          {depth === 'thorough' && <Globe className="h-3 w-3 inline mr-1" />}
                          {depth.charAt(0).toUpperCase() + depth.slice(1)}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#9a9590]">
                      {localDeepResearch.searchDepth === 'quick' && 'Fast search with 3-5 sources (~30s)'}
                      {localDeepResearch.searchDepth === 'normal' && 'Balanced search with 5-10 sources (~1-2min)'}
                      {localDeepResearch.searchDepth === 'thorough' && 'Deep research with 10-20 sources (~3-5min)'}
                    </p>
                  </div>

                  {/* Number of Sources */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[#b0a8a0]">Max Sources</label>
                      <span className="text-xs font-mono text-[var(--foreground)]">{localDeepResearch.numSources}</span>
                    </div>
                    <input
                      type="range"
                      min="3"
                      max="20"
                      value={localDeepResearch.numSources}
                      onChange={(e) => updateDeepResearch({ numSources: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-[var(--border)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
                    />
                  </div>

                  {/* Options */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 px-3 py-2 text-xs border border-[var(--border)] rounded-lg cursor-pointer hover:bg-[var(--accent)]">
                      <input
                        type="checkbox"
                        checked={localDeepResearch.autoSummarize}
                        onChange={(e) => updateDeepResearch({ autoSummarize: e.target.checked })}
                        className="w-3.5 h-3.5 rounded"
                      />
                      <Sparkles className="h-3 w-3 text-purple-400" />
                      Auto-summarize
                    </label>
                    <label className="flex items-center gap-2 px-3 py-2 text-xs border border-[var(--border)] rounded-lg cursor-pointer hover:bg-[var(--accent)]">
                      <input
                        type="checkbox"
                        checked={localDeepResearch.includeCitations}
                        onChange={(e) => updateDeepResearch({ includeCitations: e.target.checked })}
                        className="w-3.5 h-3.5 rounded"
                      />
                      <BookOpen className="h-3 w-3 text-green-400" />
                      Include citations
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Model Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Chat Model</label>
            <p className="text-xs text-[#9a9590]">
              Each chat can target a different model. Sending a message will auto-switch the backend if needed.
            </p>
            <select
              value={selectedModel}
              onChange={(e) => onSelectedModelChange?.(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--foreground)]"
            >
              <option value="" disabled>
                Select a model…
              </option>
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </div>

          {/* System Prompt Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">System Prompt</label>
              <button
                onClick={handleClear}
                className="flex items-center gap-1 text-xs text-[#9a9590] hover:text-[var(--error)] transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            </div>
            <p className="text-xs text-[#9a9590]">
              The system prompt is sent at the start of every conversation to guide the model&apos;s behavior.
            </p>
            <textarea
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              placeholder="Enter a system prompt... (e.g., You are a helpful coding assistant.)"
              className="w-full h-64 px-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded-lg resize-none focus:outline-none focus:border-[var(--foreground)] font-mono"
            />
            <div className="flex items-center gap-2 text-xs text-[#9a9590]">
              <Info className="h-3 w-3" />
              <span>{localPrompt.length} characters</span>
            </div>
          </div>

          {/* Forking Section */}
          {onForkModels && availableModels.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Fork Chat (Split)</label>
              <p className="text-xs text-[#9a9590]">
                Create parallel chats with the same history, each using a different model.
              </p>
              <div className="max-h-40 overflow-y-auto border border-[var(--border)] rounded-lg bg-[var(--background)]">
                {availableModels.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm border-b border-[var(--border)] last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={!!forkSelection[m.id]}
                      onChange={() => toggleForkModel(m.id)}
                      disabled={m.id === selectedModel}
                    />
                    <span className={`font-mono text-xs ${m.id === selectedModel ? 'text-[#9a9590]' : ''}`}>
                      {m.id}
                    </span>
                  </label>
                ))}
              </div>
              <button
                onClick={forkSelected}
                disabled={Object.values(forkSelection).every((v) => !v)}
                className="px-3 py-2 text-sm bg-[var(--foreground)] text-[var(--background)] rounded hover:opacity-90 disabled:opacity-30"
              >
                Create fork(s)
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm border border-[var(--border)] rounded hover:bg-[var(--accent)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-sm bg-[var(--foreground)] text-[var(--background)] rounded hover:opacity-90 transition-opacity"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
