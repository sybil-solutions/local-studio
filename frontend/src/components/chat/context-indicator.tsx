'use client';

import { useState, useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Gauge,
  History,
  Settings,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  ContextStats,
  ContextConfig,
  CompactionEvent,
  CompactionStrategy,
  formatTokenCount,
} from '@/lib/context-manager';

interface ContextIndicatorProps {
  stats: ContextStats;
  config: ContextConfig;
  onCompact: (strategy?: CompactionStrategy) => void;
  onUpdateConfig: (updates: Partial<ContextConfig>) => void;
  isWarning: boolean;
  isCritical: boolean;
  canSendMessage: boolean;
  utilizationLevel: 'low' | 'medium' | 'high' | 'critical';
}

const LEVEL_COLORS = {
  low: { bar: 'bg-[#7d9a6a]', text: 'text-[#7d9a6a]', bg: 'bg-[#7d9a6a]/10' },
  medium: { bar: 'bg-[#c9a66b]', text: 'text-[#c9a66b]', bg: 'bg-[#c9a66b]/10' },
  high: { bar: 'bg-[#c98b6b]', text: 'text-[#c98b6b]', bg: 'bg-[#c98b6b]/10' },
  critical: { bar: 'bg-[#c97a6b]', text: 'text-[#c97a6b]', bg: 'bg-[#c97a6b]/10' },
};

export function ContextIndicator({
  stats,
  config,
  onCompact,
  onUpdateConfig,
  isWarning,
  isCritical,
  canSendMessage,
  utilizationLevel,
}: ContextIndicatorProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const colors = LEVEL_COLORS[utilizationLevel];
  const percentage = Math.round(stats.utilization * 100);

  return (
    <div className="relative">
      {/* Compact indicator */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className={`flex items-center gap-2 px-2 py-1 rounded-lg transition-colors ${colors.bg} hover:opacity-80`}
        title={`Context: ${formatTokenCount(stats.currentTokens)} / ${formatTokenCount(stats.maxContext)} tokens (${percentage}%)`}
      >
        <Gauge className={`h-3.5 w-3.5 ${colors.text}`} />
        <div className="w-16 h-1.5 bg-[#363432] rounded-full overflow-hidden">
          <div
            className={`h-full ${colors.bar} transition-all duration-300`}
            style={{ width: `${Math.min(100, percentage)}%` }}
          />
        </div>
        <span className={`text-xs font-mono ${colors.text}`}>
          {percentage}%
        </span>
        {isWarning && (
          <AlertTriangle className="h-3.5 w-3.5 text-[#c9a66b] animate-pulse" />
        )}
        {showDetails ? (
          <ChevronUp className="h-3 w-3 text-[#9a9088]" />
        ) : (
          <ChevronDown className="h-3 w-3 text-[#9a9088]" />
        )}
      </button>

      {/* Details popup */}
      {showDetails && (
        <div className="absolute bottom-full right-0 mb-2 w-80 bg-[#1e1e1e] border border-[#363432] rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#363432]">
            <div className="flex items-center gap-2">
              <Activity className={`h-4 w-4 ${colors.text}`} />
              <span className="font-medium text-[#f0ebe3]">Context Usage</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="p-1.5 hover:bg-[#363432] rounded"
                title="Compaction history"
              >
                <History className="h-4 w-4 text-[#9a9088]" />
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-1.5 hover:bg-[#363432] rounded"
                title="Settings"
              >
                <Settings className="h-4 w-4 text-[#9a9088]" />
              </button>
              <button
                onClick={() => setShowDetails(false)}
                className="p-1.5 hover:bg-[#363432] rounded"
              >
                <X className="h-4 w-4 text-[#9a9088]" />
              </button>
            </div>
          </div>

          {showSettings ? (
            <SettingsPanel config={config} onUpdate={onUpdateConfig} />
          ) : showHistory ? (
            <HistoryPanel history={stats.compactionHistory} />
          ) : (
            <>
              {/* Main stats */}
              <div className="p-4 space-y-4">
                {/* Token bar */}
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-[#9a9088]">Tokens used</span>
                    <span className={colors.text}>
                      {formatTokenCount(stats.currentTokens)} / {formatTokenCount(stats.maxContext)}
                    </span>
                  </div>
                  <div className="h-3 bg-[#363432] rounded-full overflow-hidden">
                    <div
                      className={`h-full ${colors.bar} transition-all duration-300`}
                      style={{ width: `${Math.min(100, percentage)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-[#9a9088] mt-1">
                    <span>Headroom: {formatTokenCount(stats.headroom)}</span>
                    <span>~{stats.estimatedMessagesUntilLimit} msgs left</span>
                  </div>
                </div>

                {/* Breakdown */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-[#1b1b1b] p-2 rounded">
                    <div className="text-[#9a9088] text-xs">Messages</div>
                    <div className="text-[#f0ebe3] font-mono">{stats.messagesCount}</div>
                  </div>
                  <div className="bg-[#1b1b1b] p-2 rounded">
                    <div className="text-[#9a9088] text-xs">Conversation</div>
                    <div className="text-[#f0ebe3] font-mono">{formatTokenCount(stats.conversationTokens)}</div>
                  </div>
                  <div className="bg-[#1b1b1b] p-2 rounded">
                    <div className="text-[#9a9088] text-xs">System prompt</div>
                    <div className="text-[#f0ebe3] font-mono">{formatTokenCount(stats.systemPromptTokens)}</div>
                  </div>
                  <div className="bg-[#1b1b1b] p-2 rounded">
                    <div className="text-[#9a9088] text-xs">Tools</div>
                    <div className="text-[#f0ebe3] font-mono">{formatTokenCount(stats.toolsTokens)}</div>
                  </div>
                </div>

                {/* Warning message */}
                {!canSendMessage && (
                  <div className="flex items-center gap-2 p-2 bg-[#c97a6b]/10 rounded text-sm text-[#c97a6b]">
                    <AlertTriangle className="h-4 w-4" />
                    Context nearly full. Compact to continue.
                  </div>
                )}

                {/* Lifetime stats */}
                {stats.totalCompactions > 0 && (
                  <div className="text-xs text-[#9a9088] border-t border-[#363432] pt-3">
                    Total compactions: {stats.totalCompactions} ({formatTokenCount(stats.totalTokensCompacted)} tokens freed)
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="p-4 border-t border-[#363432] flex gap-2">
                <button
                  onClick={() => onCompact('sliding_window')}
                  disabled={stats.messagesCount <= config.preserveRecentMessages}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-[#8b7355] text-white rounded-lg hover:bg-[#8b7355]/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  <Zap className="h-4 w-4" />
                  Compact
                </button>
                <button
                  onClick={() => onCompact('truncate')}
                  disabled={stats.messagesCount <= config.preserveRecentMessages}
                  className="flex items-center justify-center gap-2 px-3 py-2 border border-[#363432] text-[#9a9088] rounded-lg hover:bg-[#2a2826] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  title="Truncate (remove oldest)"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsPanel({
  config,
  onUpdate,
}: {
  config: ContextConfig;
  onUpdate: (updates: Partial<ContextConfig>) => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="block text-sm text-[#9a9088] mb-2">
          Compaction threshold ({Math.round(config.compactionThreshold * 100)}%)
        </label>
        <input
          type="range"
          min="50"
          max="95"
          value={config.compactionThreshold * 100}
          onChange={(e) => onUpdate({ compactionThreshold: parseInt(e.target.value) / 100 })}
          className="w-full accent-[#8b7355]"
        />
      </div>
      <div>
        <label className="block text-sm text-[#9a9088] mb-2">
          Target after compaction ({Math.round(config.targetAfterCompaction * 100)}%)
        </label>
        <input
          type="range"
          min="20"
          max="70"
          value={config.targetAfterCompaction * 100}
          onChange={(e) => onUpdate({ targetAfterCompaction: parseInt(e.target.value) / 100 })}
          className="w-full accent-[#8b7355]"
        />
      </div>
      <div>
        <label className="block text-sm text-[#9a9088] mb-2">
          Preserve recent messages: {config.preserveRecentMessages}
        </label>
        <input
          type="range"
          min="2"
          max="20"
          value={config.preserveRecentMessages}
          onChange={(e) => onUpdate({ preserveRecentMessages: parseInt(e.target.value) })}
          className="w-full accent-[#8b7355]"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-[#f0ebe3]">
        <input
          type="checkbox"
          checked={config.autoCompact}
          onChange={(e) => onUpdate({ autoCompact: e.target.checked })}
          className="accent-[#8b7355]"
        />
        Auto-compact when threshold reached
      </label>
    </div>
  );
}

function HistoryPanel({ history }: { history: CompactionEvent[] }) {
  const sortedHistory = useMemo(
    () => [...history].reverse().slice(0, 20),
    [history]
  );

  if (history.length === 0) {
    return (
      <div className="p-4 text-center text-[#9a9088] text-sm">
        No compaction history yet
      </div>
    );
  }

  return (
    <div className="max-h-64 overflow-auto">
      {sortedHistory.map((event) => (
        <div
          key={event.id}
          className="p-3 border-b border-[#363432] last:border-0"
        >
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#f0ebe3]">{event.strategy}</span>
            <span className="text-xs text-[#9a9088]">
              {event.timestamp.toLocaleTimeString()}
            </span>
          </div>
          <div className="text-xs text-[#9a9088] mt-1">
            {formatTokenCount(event.beforeTokens)} → {formatTokenCount(event.afterTokens)} tokens
            ({event.messagesRemoved} messages removed)
          </div>
        </div>
      ))}
    </div>
  );
}

export default ContextIndicator;
