'use client';

import { useState, useEffect } from 'react';
import { X, Settings, Trash2, Info, Search, Globe, Zap, FileText, BookOpen, Sparkles, Brain, Database, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export interface DeepResearchSettings {
  enabled: boolean;
  numSources: number;
  autoSummarize: boolean;
  includeCitations: boolean;
  searchDepth: 'quick' | 'normal' | 'thorough';
}

export interface RAGSettings {
  enabled: boolean;
  endpoint: string;
  apiKey?: string;
  topK: number;
  minScore: number;
  includeMetadata: boolean;
  contextPosition: 'before' | 'after' | 'system';
  useProxy: boolean; // Use frontend proxy for remote access (Cloudflare etc)
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
  // RAG settings
  ragSettings?: RAGSettings;
  onRagSettingsChange?: (settings: RAGSettings) => void;
  onTestRagConnection?: () => Promise<{ status: string; documents_count?: number }>;
}

const STORAGE_KEY = 'vllm-studio-system-prompt';

const DEFAULT_DEEP_RESEARCH: DeepResearchSettings = {
  enabled: false,
  numSources: 5,
  autoSummarize: true,
  includeCitations: true,
  searchDepth: 'normal',
};

const DEFAULT_RAG_SETTINGS: RAGSettings = {
  enabled: false,
  endpoint: 'http://localhost:3002',
  topK: 5,
  minScore: 0.0,
  includeMetadata: true,
  contextPosition: 'system',
  useProxy: true, // Default to proxy mode for remote access
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
  ragSettings = DEFAULT_RAG_SETTINGS,
  onRagSettingsChange,
  onTestRagConnection,
}: ChatSettingsModalProps) {
  const [localPrompt, setLocalPrompt] = useState(systemPrompt);
  const [forkSelection, setForkSelection] = useState<Record<string, boolean>>({});
  const [localDeepResearch, setLocalDeepResearch] = useState(deepResearch);
  const [localRagSettings, setLocalRagSettings] = useState(ragSettings);
  const [ragTestStatus, setRagTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [ragTestResult, setRagTestResult] = useState<string | null>(null);

  useEffect(() => {
    setLocalPrompt(systemPrompt);
  }, [systemPrompt]);

  useEffect(() => {
    setLocalDeepResearch(deepResearch);
  }, [deepResearch]);

  useEffect(() => {
    setLocalRagSettings(ragSettings);
  }, [ragSettings]);

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
    if (onRagSettingsChange) {
      onRagSettingsChange(localRagSettings);
      localStorage.setItem('vllm-studio-rag-settings', JSON.stringify(localRagSettings));
    }
    onClose();
  };

  const handleTestRagConnection = async () => {
    if (!onTestRagConnection) return;
    setRagTestStatus('testing');
    setRagTestResult(null);
    try {
      const result = await onTestRagConnection();
      if (result.status === 'ok' || result.status === 'healthy') {
        setRagTestStatus('success');
        setRagTestResult(result.documents_count !== undefined
          ? `Connected (${result.documents_count} documents)`
          : 'Connected');
      } else {
        setRagTestStatus('error');
        setRagTestResult(result.status || 'Connection failed');
      }
    } catch (error) {
      setRagTestStatus('error');
      setRagTestResult(error instanceof Error ? error.message : 'Connection failed');
    }
  };

  const updateRagSettings = (updates: Partial<RAGSettings>) => {
    setLocalRagSettings(prev => ({ ...prev, ...updates }));
    setRagTestStatus('idle');
    setRagTestResult(null);
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
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/50 p-0 md:p-4 overflow-auto">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-none md:rounded-lg w-full max-w-2xl min-h-screen md:min-h-0 md:max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header - Sticky on mobile */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--card)]">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[var(--accent-purple)]" />
            <h2 className="font-medium">Chat Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded hover:bg-[var(--accent)] transition-colors touch-manipulation"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Deep Research Section - Featured at top */}
          {onDeepResearchChange && (
            <div className="space-y-3 p-4 bg-gradient-to-br from-blue-500/5 to-purple-500/5 border border-blue-500/20 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-[var(--highlight-bg)] rounded-lg">
                    <Brain className="h-4 w-4 text-[var(--accent-purple)]" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Deep Research Mode</label>
                    <p className="text-[10px] text-[#9a9590]">Multi-step web research with source synthesis</p>
                  </div>
                </div>
                <button
                  onClick={() => updateDeepResearch({ enabled: !localDeepResearch.enabled })}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    localDeepResearch.enabled ? 'bg-[var(--accent-purple)]' : 'bg-[var(--border)]'
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
                              ? 'bg-[var(--highlight-bg)] border-[var(--accent-purple)]/40 text-[var(--accent-purple)]'
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
                      className="w-full h-1.5 bg-[var(--border)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent-purple)]"
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
                      <Sparkles className="h-3 w-3 text-[var(--accent-purple)]" />
                      Auto-summarize
                    </label>
                    <label className="flex items-center gap-2 px-3 py-2 text-xs border border-[var(--border)] rounded-lg cursor-pointer hover:bg-[var(--accent)]">
                      <input
                        type="checkbox"
                        checked={localDeepResearch.includeCitations}
                        onChange={(e) => updateDeepResearch({ includeCitations: e.target.checked })}
                        className="w-3.5 h-3.5 rounded"
                      />
                      <BookOpen className="h-3 w-3 text-[var(--accent-purple)]" />
                      Include citations
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* RAG Section */}
          {onRagSettingsChange && (
            <div className="space-y-3 p-4 bg-gradient-to-br from-green-500/5 to-emerald-500/5 border border-green-500/20 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-[var(--highlight-bg)] rounded-lg">
                    <Database className="h-4 w-4 text-[var(--accent-purple)]" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">RAG Knowledge Base</label>
                    <p className="text-[10px] text-[#9a9590]">Connect to your own retrieval-augmented generation service</p>
                  </div>
                </div>
                <button
                  onClick={() => updateRagSettings({ enabled: !localRagSettings.enabled })}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    localRagSettings.enabled ? 'bg-[var(--accent-purple)]' : 'bg-[var(--border)]'
                  }`}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    localRagSettings.enabled ? 'left-6' : 'left-1'
                  }`} />
                </button>
              </div>

              {localRagSettings.enabled && (
                <div className="space-y-3 pt-2 border-t border-[var(--border)]">
                  {/* Endpoint URL */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[#b0a8a0]">RAG Endpoint</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={localRagSettings.endpoint}
                        onChange={(e) => updateRagSettings({ endpoint: e.target.value })}
                        placeholder="http://localhost:3002"
                        className="flex-1 px-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent-purple)]/50 font-mono"
                      />
                      <button
                        onClick={handleTestRagConnection}
                        disabled={ragTestStatus === 'testing' || !localRagSettings.endpoint}
                        className="px-3 py-2 text-xs bg-[var(--highlight-bg)] border border-[var(--accent-purple)]/30 rounded-lg hover:bg-[var(--accent-purple)]/20 disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {ragTestStatus === 'testing' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-purple)]" />
                        ) : ragTestStatus === 'success' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
                        ) : ragTestStatus === 'error' ? (
                          <XCircle className="h-3.5 w-3.5 text-[var(--error)]" />
                        ) : (
                          <Database className="h-3.5 w-3.5 text-[var(--accent-purple)]" />
                        )}
                        Test
                      </button>
                    </div>
                    {ragTestResult && (
                      <p className={`text-xs ${ragTestStatus === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                        {ragTestResult}
                      </p>
                    )}
                  </div>

                  {/* API Key (optional) */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[#b0a8a0]">API Key (optional)</label>
                    <input
                      type="password"
                      value={localRagSettings.apiKey || ''}
                      onChange={(e) => updateRagSettings({ apiKey: e.target.value || undefined })}
                      placeholder="Leave empty if not required"
                      className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent-purple)]/50"
                    />
                  </div>

                  {/* Top K Results */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[#b0a8a0]">Results to Retrieve (Top K)</label>
                      <span className="text-xs font-mono text-[var(--foreground)]">{localRagSettings.topK}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      value={localRagSettings.topK}
                      onChange={(e) => updateRagSettings({ topK: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-[var(--border)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent-purple)]"
                    />
                  </div>

                  {/* Min Score */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[#b0a8a0]">Minimum Relevance Score</label>
                      <span className="text-xs font-mono text-[var(--foreground)]">{localRagSettings.minScore.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={localRagSettings.minScore * 100}
                      onChange={(e) => updateRagSettings({ minScore: parseInt(e.target.value) / 100 })}
                      className="w-full h-1.5 bg-[var(--border)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent-purple)]"
                    />
                  </div>

                  {/* Context Position */}
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[#b0a8a0]">Context Injection Position</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['system', 'before', 'after'] as const).map((pos) => (
                        <button
                          key={pos}
                          onClick={() => updateRagSettings({ contextPosition: pos })}
                          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                            localRagSettings.contextPosition === pos
                              ? 'bg-[var(--highlight-bg)] border-[var(--accent-purple)]/40 text-[var(--accent-purple)]'
                              : 'border-[var(--border)] hover:bg-[var(--accent)]'
                          }`}
                        >
                          {pos === 'system' ? 'System Prompt' : pos === 'before' ? 'Before Query' : 'After Query'}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#9a9590]">
                      {localRagSettings.contextPosition === 'system' && 'RAG context added to system prompt'}
                      {localRagSettings.contextPosition === 'before' && 'RAG context prepended to user message'}
                      {localRagSettings.contextPosition === 'after' && 'RAG context appended to user message'}
                    </p>
                  </div>

                  {/* Include Metadata */}
                  <label className="flex items-center gap-2 px-3 py-2 text-xs border border-[var(--border)] rounded-lg cursor-pointer hover:bg-[var(--accent)]">
                    <input
                      type="checkbox"
                      checked={localRagSettings.includeMetadata}
                      onChange={(e) => updateRagSettings({ includeMetadata: e.target.checked })}
                      className="w-3.5 h-3.5 rounded"
                    />
                    <FileText className="h-3 w-3 text-[var(--accent-purple)]" />
                    Include source metadata in context
                  </label>

                  {/* Use Proxy Mode */}
                  <label className="flex items-center gap-2 px-3 py-2 text-xs border border-[var(--border)] rounded-lg cursor-pointer hover:bg-[var(--accent)]">
                    <input
                      type="checkbox"
                      checked={localRagSettings.useProxy}
                      onChange={(e) => updateRagSettings({ useProxy: e.target.checked })}
                      className="w-3.5 h-3.5 rounded"
                    />
                    <Globe className="h-3 w-3 text-[var(--accent-purple)]" />
                    Use server proxy (for remote access via Cloudflare)
                  </label>
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

        {/* Footer - Sticky on mobile */}
        <div className="sticky bottom-0 z-10 flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)] bg-[var(--card)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-[var(--border)] rounded hover:bg-[var(--accent)] transition-colors touch-manipulation"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-[var(--accent-purple)] text-white rounded hover:opacity-90 transition-opacity touch-manipulation"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
