'use client';

import { useEffect } from 'react';
import {
  X,
  Globe,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Server,
  Terminal,
} from 'lucide-react';
import api from '@/lib/api';
import { useAppStore } from '@/store';

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  icon?: string;
}

interface MCPSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  servers: MCPServerConfig[];
  onServersChange: (servers: MCPServerConfig[]) => void;
}

export function MCPSettingsModal({
  isOpen,
  onClose,
  servers,
  onServersChange,
}: MCPSettingsModalProps) {
  const legacyMcpSettings = useAppStore((state) => state.legacyMcpSettings);
  const setLegacyMcpSettings = useAppStore((state) => state.setLegacyMcpSettings);
  const { localServers, isAdding, newServer, envPairs, error, saving } = legacyMcpSettings;

  useEffect(() => {
    setLegacyMcpSettings({ localServers: servers });
  }, [servers, setLegacyMcpSettings]);

  if (!isOpen) return null;

  const toggleServer = async (name: string) => {
    const current = localServers.find((s) => s.name === name);
    if (!current) return;
    const nextEnabled = !current.enabled;

    // Optimistic UI update
    setLegacyMcpSettings({
      localServers: localServers.map((s) =>
        s.name === name ? { ...s, enabled: nextEnabled } : s,
      ),
    });

    try {
      await api.updateMCPServer(name, { enabled: nextEnabled });
    } catch (e) {
      // Revert on failure
      setLegacyMcpSettings({
        localServers: localServers.map((s) =>
          s.name === name ? { ...s, enabled: current.enabled } : s,
        ),
        error: `Failed to update server: ${e}`,
      });
    }
  };

  const removeServer = async (name: string) => {
    try {
      await api.removeMCPServer(name);
      setLegacyMcpSettings({ localServers: localServers.filter((s) => s.name !== name) });
    } catch (e) {
      setLegacyMcpSettings({ error: `Failed to remove server: ${e}` });
    }
  };

  const addServer = async () => {
    if (!newServer.name || !newServer.command) {
      setLegacyMcpSettings({ error: 'Name and command are required' });
      return;
    }

    setLegacyMcpSettings({ saving: true, error: null });

    try {
      const env: Record<string, string> = {};
      envPairs.forEach((pair) => {
        if (pair.key) env[pair.key] = pair.value;
      });

      const server: MCPServerConfig = {
        name: newServer.name,
        command: newServer.command,
        args: newServer.args.split(' ').filter(Boolean),
        env,
        enabled: true,
      };

      await api.addMCPServer({
        name: server.name,
        command: server.command,
        args: server.args,
        env: server.env,
      });

      setLegacyMcpSettings({
        localServers: [...localServers, server],
        newServer: { name: '', command: '', args: '', envKey: '', envValue: '' },
        envPairs: [],
        isAdding: false,
      });
    } catch (e) {
      setLegacyMcpSettings({ error: `Failed to add server: ${e}` });
    } finally {
      setLegacyMcpSettings({ saving: false });
    }
  };

  const handleSave = () => {
    onServersChange(
      localServers.map((server) => ({
        ...server,
        name: server.name ?? '',
        command: server.command ?? '',
        args: server.args ?? [],
        env: server.env ?? {},
        enabled: server.enabled ?? true,
        icon: server.icon ?? 'spinner',
      }))
    );
    onClose();
  };

  const addEnvPair = () => {
    setLegacyMcpSettings({ envPairs: [...envPairs, { key: '', value: '' }] });
  };

  const updateEnvPair = (index: number, field: 'key' | 'value', value: string) => {
    setLegacyMcpSettings({
      envPairs: envPairs.map((pair, i) => (i === index ? { ...pair, [field]: value } : pair)),
    });
  };

  const removeEnvPair = (index: number) => {
    setLegacyMcpSettings({ envPairs: envPairs.filter((_, i) => i !== index) });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-[#9a9590]" />
            <div>
              <h2 className="font-medium">MCP Servers</h2>
              <p className="text-xs text-[#9a9590]">Configure tools like web search, fetch, etc.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--accent)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--error)]/10 border border-[var(--error)]/20 rounded text-sm text-[var(--error)]">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* Server List */}
          {localServers.map((server) => (
            <div
              key={server.name}
              className="flex items-center justify-between px-3 py-2 bg-[var(--accent)] rounded-lg border border-[var(--border)]"
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleServer(server.name)}
                  className={`w-8 h-5 rounded-full transition-colors ${
                    server.enabled ? 'bg-[var(--success)]' : 'bg-[var(--muted)]'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      server.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    {server.name === 'brave-search' ? (
                      <Globe className="h-3.5 w-3.5 text-blue-500" />
                    ) : (
                      <Terminal className="h-3.5 w-3.5 text-[#9a9590]" />
                    )}
                    <span className="text-sm font-medium">{server.name}</span>
                  </div>
                  <p className="text-xs text-[#9a9590]">
                    {server.command} {server.args?.join(' ')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => removeServer(server.name)}
                className="p-1.5 rounded hover:bg-[var(--error)]/20 text-[#9a9590] hover:text-[var(--error)] transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {localServers.length === 0 && !isAdding && (
            <div className="text-center py-8 text-[#9a9590] text-sm space-y-2">
              <p>No MCP servers configured</p>
              <p className="text-xs">Add servers like brave-search, fetch, or time to enable tools</p>
            </div>
          )}

          {/* Help text */}
          {localServers.length > 0 && (
            <div className="text-xs text-[#9a9590] bg-[var(--background)] p-3 rounded-lg border border-[var(--border)]">
              <p className="font-medium mb-1">How to use:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Enable servers you want to use (toggle on)</li>
                <li>Click &quot;Tools&quot; in the toolbar to enable tool calling</li>
                <li>The model will automatically use tools when helpful</li>
              </ol>
            </div>
          )}

          {/* Add Server Form */}
          {isAdding ? (
            <div className="space-y-3 p-3 bg-[var(--accent)] rounded-lg border border-[var(--border)]">
              <input
                type="text"
                placeholder="Server name (e.g., brave-search)"
                value={newServer.name}
                onChange={(e) =>
                  setLegacyMcpSettings({ newServer: { ...newServer, name: e.target.value } })
                }
                className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded focus:outline-none focus:border-[var(--foreground)]"
              />
              <input
                type="text"
                placeholder="Command (e.g., npx)"
                value={newServer.command}
                onChange={(e) =>
                  setLegacyMcpSettings({ newServer: { ...newServer, command: e.target.value } })
                }
                className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded focus:outline-none focus:border-[var(--foreground)]"
              />
              <input
                type="text"
                placeholder="Arguments (e.g., -y @modelcontextprotocol/server-brave-search)"
                value={newServer.args}
                onChange={(e) =>
                  setLegacyMcpSettings({ newServer: { ...newServer, args: e.target.value } })
                }
                className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded focus:outline-none focus:border-[var(--foreground)]"
              />

              {/* Environment Variables */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#9a9590]">Environment Variables</span>
                  <button
                    onClick={addEnvPair}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    + Add variable
                  </button>
                </div>
                {envPairs.map((pair, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="KEY"
                      value={pair.key}
                      onChange={(e) => updateEnvPair(index, 'key', e.target.value)}
                      className="flex-1 px-2 py-1 text-xs bg-[var(--background)] border border-[var(--border)] rounded focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="value"
                      value={pair.value}
                      onChange={(e) => updateEnvPair(index, 'value', e.target.value)}
                      className="flex-1 px-2 py-1 text-xs bg-[var(--background)] border border-[var(--border)] rounded focus:outline-none"
                    />
                    <button
                      onClick={() => removeEnvPair(index)}
                      className="p-1 text-[#9a9590] hover:text-[var(--error)]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setLegacyMcpSettings({
                      isAdding: false,
                      newServer: { name: '', command: '', args: '', envKey: '', envValue: '' },
                      envPairs: [],
                    });
                  }}
                  className="flex-1 px-3 py-1.5 text-sm border border-[var(--border)] rounded hover:bg-[var(--background)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={addServer}
                  disabled={saving}
                  className="flex-1 px-3 py-1.5 text-sm bg-[var(--foreground)] text-[var(--background)] rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {saving ? 'Adding...' : 'Add Server'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setLegacyMcpSettings({ isAdding: true })}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-dashed border-[var(--border)] rounded-lg hover:bg-[var(--accent)] transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add MCP Server
            </button>
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
