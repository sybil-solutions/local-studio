// CRITICAL
"use client";

import { X, Server, RefreshCw, Trash2 } from "lucide-react";
import type { MCPServer } from "@/lib/types";
import { McpServerForm, type McpServerFormPayload } from "@/components/mcp";
import { useAppStore } from "@/store";

interface MCPSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  servers: MCPServer[];
  onAddServer: (server: MCPServer) => Promise<void>;
  onUpdateServer: (server: MCPServer) => Promise<void>;
  onRemoveServer: (name: string) => Promise<void>;
  onRefresh?: () => void;
}

export function MCPSettingsModal({
  isOpen,
  onClose,
  servers,
  onAddServer,
  onUpdateServer,
  onRemoveServer,
  onRefresh,
}: MCPSettingsModalProps) {
  const pendingServer = useAppStore((state) => state.mcpPendingServer);
  const setPendingServer = useAppStore((state) => state.setMcpPendingServer);
  const actionError = useAppStore((state) => state.mcpActionError);
  const setActionError = useAppStore((state) => state.setMcpActionError);
  if (!isOpen) return null;

  const handleAddServer = async (payload: McpServerFormPayload) => {
    setActionError(null);
    await onAddServer(payload);
  };

  const handleToggleServer = async (server: MCPServer) => {
    setPendingServer(server.name);
    setActionError(null);
    try {
      await onUpdateServer({ ...server, enabled: !server.enabled });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to update server.");
    } finally {
      setPendingServer(null);
    }
  };

  const handleRemoveServer = async (server: MCPServer) => {
    if (!window.confirm(`Remove MCP server "${server.name}"?`)) return;
    setPendingServer(server.name);
    setActionError(null);
    try {
      await onRemoveServer(server.name);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to remove server.");
    } finally {
      setPendingServer(null);
    }
  };

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
            <Server className="h-5 w-5 text-[#9a9590]" />
            <h2 className="text-lg font-semibold">MCP Servers</h2>
          </div>
          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="p-1.5 rounded hover:bg-(--accent)"
                title="Refresh servers"
              >
                <RefreshCw className="h-4 w-4 text-[#9a9590]" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-(--accent)"
            >
              <X className="h-5 w-5 text-[#9a9590]" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          <McpServerForm
            onSubmit={handleAddServer}
            title="Add MCP server"
            submitLabel="Add server"
            submittingLabel="Adding…"
            testIdPrefix="mcp-settings-form"
          />

          <div className="space-y-4">
            {servers.length === 0 ? (
              <div className="text-center py-8 text-[#6a6560]">
                <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No MCP servers configured</p>
              </div>
            ) : (
              servers.map((server) => (
                <div
                  key={server.name}
                  className="flex flex-col gap-3 p-3 bg-(--background) border border-(--border) rounded-lg"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-(--accent) flex items-center justify-center">
                        {server.icon ? (
                          <span className="text-sm">{server.icon}</span>
                        ) : (
                          <Server className="h-4 w-4 text-[#9a9590]" />
                        )}
                      </div>
                      <div>
                        <span className="text-sm font-medium">{server.name}</span>
                        <p className="text-xs text-[#6a6560]">{server.command}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleServer(server)}
                        disabled={pendingServer === server.name}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-60 ${
                          server.enabled
                            ? "bg-(--success)/20 text-(--success)"
                            : "bg-(--accent) text-[#6a6560]"
                        }`}
                      >
                        {server.enabled ? "Enabled" : "Disabled"}
                      </button>
                      <button
                        onClick={() => handleRemoveServer(server)}
                        className="p-1.5 rounded hover:bg-(--accent)"
                        title="Remove server"
                      >
                        <Trash2 className="h-4 w-4 text-[#9a9590]" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
            {actionError && <p className="text-xs text-(--error)">{actionError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
