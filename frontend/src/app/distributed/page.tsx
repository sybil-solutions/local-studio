// CRITICAL
"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Server, Share2 } from "lucide-react";
import { PageState } from "@/components/shared";
import api from "@/lib/api";
import { useDistributedCluster } from "./hooks/use-distributed-cluster";

const formatTime = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const summarizeRecord = (value: Record<string, unknown>) => {
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  return `${keys.length} key${keys.length === 1 ? "" : "s"}`;
};

export default function DistributedPage() {
  const [scopeModelId, setScopeModelId] = useState("");
  const [scopeTotalLayersInput, setScopeTotalLayersInput] = useState("");
  const [registering, setRegistering] = useState(false);
  const [savingAllocation, setSavingAllocation] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [nodeForm, setNodeForm] = useState({
    node_id: "",
    label: "",
    backend: "",
    transport: "",
    host: "",
    port: "",
  });

  const [allocationForm, setAllocationForm] = useState({
    node_id: "",
    start_layer: "0",
    end_layer: "1",
  });

  const totalLayers = useMemo(() => {
    if (!scopeTotalLayersInput.trim()) return null;
    const value = Number(scopeTotalLayersInput);
    return Number.isInteger(value) && value > 0 ? value : null;
  }, [scopeTotalLayersInput]);

  const cluster = useDistributedCluster(scopeModelId, totalLayers);

  useEffect(() => {
    if (scopeModelId.trim()) return;
    const firstModel = cluster.status?.models[0];
    if (firstModel) {
      setScopeModelId(firstModel);
    }
  }, [cluster.status?.models, scopeModelId]);

  useEffect(() => {
    if (allocationForm.node_id) return;
    const firstNode = cluster.nodes[0]?.node_id ?? "";
    if (firstNode) {
      setAllocationForm((current) => ({ ...current, node_id: firstNode }));
    }
  }, [allocationForm.node_id, cluster.nodes]);

  const handleRegisterNode = async (event: FormEvent) => {
    event.preventDefault();
    if (!nodeForm.node_id.trim()) {
      setActionError("node_id is required");
      return;
    }
    setRegistering(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await api.registerDistributedNode({
        node_id: nodeForm.node_id.trim(),
        label: nodeForm.label.trim() || undefined,
        backend: nodeForm.backend.trim() || undefined,
        transport: nodeForm.transport.trim() || undefined,
        host: nodeForm.host.trim() || undefined,
        port: nodeForm.port.trim() ? Number(nodeForm.port) : undefined,
      });
      setActionMessage(`Registered node ${nodeForm.node_id.trim()}`);
      setNodeForm((current) => ({ ...current, node_id: "" }));
      await cluster.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setRegistering(false);
    }
  };

  const handleSetAllocation = async (event: FormEvent) => {
    event.preventDefault();
    const modelId = scopeModelId.trim();
    if (!modelId) {
      setActionError("Model scope is required before setting allocations");
      return;
    }
    if (!allocationForm.node_id.trim()) {
      setActionError("node_id is required");
      return;
    }
    setSavingAllocation(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await api.setDistributedAllocation(allocationForm.node_id.trim(), {
        model_id: modelId,
        start_layer: Number(allocationForm.start_layer),
        end_layer: Number(allocationForm.end_layer),
      });
      setActionMessage(
        `Allocation set for ${allocationForm.node_id.trim()} [${allocationForm.start_layer}, ${allocationForm.end_layer})`,
      );
      await cluster.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingAllocation(false);
    }
  };

  const handleClearAllocation = async (nodeId: string) => {
    const modelId = scopeModelId.trim();
    if (!modelId) return;
    setActionError(null);
    setActionMessage(null);
    try {
      await api.clearDistributedAllocation(nodeId, modelId);
      setActionMessage(`Removed allocation for ${nodeId}`);
      await cluster.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const pageState = PageState({
    loading: cluster.loading,
    data: cluster.status,
    hasData: Boolean(cluster.status),
    error: cluster.error,
    onLoad: cluster.refresh,
  });
  if (pageState) {
    return <div className="min-h-full bg-(--surface)">{pageState}</div>;
  }

  return (
    <div className="min-h-full bg-(--surface) text-(--fg) overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-(--dim)" />
              <h1 className="text-lg font-medium">Distributed Cluster</h1>
            </div>
            <p className="text-xs text-(--dim) mt-1">
              Register nodes, assign layer slices, and validate topology for cross-device hosting.
            </p>
          </div>
          <button
            onClick={cluster.refresh}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-(--border) hover:bg-(--surface)"
          >
            <RefreshCw className={`h-4 w-4 ${cluster.loading ? "animate-spin" : ""}`} />
            <span className="text-sm">Refresh</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-(--border) bg-(--bg) p-3">
            <div className="text-[10px] uppercase tracking-wider text-(--dim)">Nodes</div>
            <div className="text-xl mt-1">{cluster.status?.nodes_total ?? 0}</div>
          </div>
          <div className="rounded-lg border border-(--border) bg-(--bg) p-3">
            <div className="text-[10px] uppercase tracking-wider text-(--dim)">Online</div>
            <div className="text-xl mt-1 text-emerald-400">{cluster.status?.nodes_online ?? 0}</div>
          </div>
          <div className="rounded-lg border border-(--border) bg-(--bg) p-3">
            <div className="text-[10px] uppercase tracking-wider text-(--dim)">Stale</div>
            <div className="text-xl mt-1 text-amber-400">{cluster.status?.nodes_stale ?? 0}</div>
          </div>
          <div className="rounded-lg border border-(--border) bg-(--bg) p-3">
            <div className="text-[10px] uppercase tracking-wider text-(--dim)">Models</div>
            <div className="text-xl mt-1">{cluster.status?.models.length ?? 0}</div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <form
            onSubmit={handleRegisterNode}
            className="rounded-lg border border-(--border) bg-(--bg) p-4 space-y-3"
          >
            <div className="flex items-center gap-2 text-sm">
              <Server className="h-4 w-4 text-(--dim)" />
              <span>Register Node</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={nodeForm.node_id}
                onChange={(event) => setNodeForm((v) => ({ ...v, node_id: event.target.value }))}
                placeholder="node_id"
                className="px-3 py-2 rounded-lg bg-(--surface) border border-(--border) text-sm"
              />
              <input
                value={nodeForm.label}
                onChange={(event) => setNodeForm((v) => ({ ...v, label: event.target.value }))}
                placeholder="label"
                className="px-3 py-2 rounded-lg bg-(--surface) border border-(--border) text-sm"
              />
              <input
                value={nodeForm.backend}
                onChange={(event) => setNodeForm((v) => ({ ...v, backend: event.target.value }))}
                placeholder="backend (vllm/mlx/...)"
                className="px-3 py-2 rounded-lg bg-(--surface) border border-(--border) text-sm"
              />
              <input
                value={nodeForm.transport}
                onChange={(event) => setNodeForm((v) => ({ ...v, transport: event.target.value }))}
                placeholder="transport"
                className="px-3 py-2 rounded-lg bg-(--surface) border border-(--border) text-sm"
              />
              <input
                value={nodeForm.host}
                onChange={(event) => setNodeForm((v) => ({ ...v, host: event.target.value }))}
                placeholder="host"
                className="px-3 py-2 rounded-lg bg-(--surface) border border-(--border) text-sm"
              />
              <input
                value={nodeForm.port}
                onChange={(event) => setNodeForm((v) => ({ ...v, port: event.target.value }))}
                placeholder="port"
                className="px-3 py-2 rounded-lg bg-(--surface) border border-(--border) text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={registering}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-(--hl1) text-white text-sm disabled:opacity-60"
            >
              {registering ? <Activity className="h-4 w-4 animate-spin" /> : null}
              Register
            </button>
          </form>

          <div className="rounded-lg border border-(--border) bg-(--bg) p-4 space-y-3">
            <div className="text-sm">Model Scope</div>
            <div className="grid grid-cols-[1fr,140px] gap-2">
              <input
                value={scopeModelId}
                onChange={(event) => setScopeModelId(event.target.value)}
                placeholder="model_id"
                className="px-3 py-2 rounded-lg bg-(--surface) border border-(--border) text-sm"
              />
              <input
                value={scopeTotalLayersInput}
                onChange={(event) => setScopeTotalLayersInput(event.target.value)}
                placeholder="total layers"
                className="px-3 py-2 rounded-lg bg-(--surface) border border-(--border) text-sm"
              />
            </div>
            <p className="text-xs text-(--dim)">
              Empty model scope shows cluster-level status only. Set both model and total layers to validate
              contiguous full coverage.
            </p>
          </div>
        </div>

        {actionError && (
          <div className="rounded-lg border border-(--err)/30 bg-(--err)/10 p-3 text-sm text-(--err)">
            {actionError}
          </div>
        )}
        {actionMessage && (
          <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-300">
            {actionMessage}
          </div>
        )}

        <div className="rounded-lg border border-(--border) bg-(--bg) overflow-hidden">
          <div className="px-4 py-3 border-b border-(--border) text-sm">Nodes</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-(--dim) border-b border-(--border)">
                  <th className="text-left py-2 px-4">Node</th>
                  <th className="text-left py-2 px-4">Backend</th>
                  <th className="text-left py-2 px-4">Location</th>
                  <th className="text-left py-2 px-4">Capabilities</th>
                  <th className="text-left py-2 px-4">Metrics</th>
                  <th className="text-left py-2 px-4">Heartbeat</th>
                  <th className="text-left py-2 px-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {cluster.nodes.map((node, index) => (
                  <tr key={node.node_id} className={index > 0 ? "border-t border-(--border)/50" : ""}>
                    <td className="py-2 px-4">
                      <div className="font-mono text-xs">{node.node_id}</div>
                      {node.label ? <div className="text-[11px] text-(--dim)">{node.label}</div> : null}
                    </td>
                    <td className="py-2 px-4 text-xs uppercase">{node.backend ?? "-"}</td>
                    <td className="py-2 px-4 text-xs">
                      {[node.host, node.port].filter(Boolean).join(":") || "-"}
                    </td>
                    <td className="py-2 px-4 text-xs text-(--dim)">{summarizeRecord(node.capabilities)}</td>
                    <td className="py-2 px-4 text-xs text-(--dim)">{summarizeRecord(node.metrics)}</td>
                    <td className="py-2 px-4 text-xs">{formatTime(node.last_heartbeat_at)}</td>
                    <td className="py-2 px-4">
                      <div className="inline-flex items-center gap-1 text-xs">
                        {node.stale ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        )}
                        <span className={node.stale ? "text-amber-300" : "text-emerald-300"}>
                          {node.stale ? "stale" : node.status}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
                {cluster.nodes.length === 0 ? (
                  <tr>
                    <td className="py-4 px-4 text-(--dim)" colSpan={7}>
                      No nodes registered yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <form
            onSubmit={handleSetAllocation}
            className="rounded-lg border border-(--border) bg-(--bg) p-4 space-y-3"
          >
            <div className="text-sm">Set Allocation</div>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={allocationForm.node_id}
                onChange={(event) => setAllocationForm((v) => ({ ...v, node_id: event.target.value }))}
                className="px-3 py-2 rounded-lg bg-(--surface) border border-(--border) text-sm"
              >
                <option value="">Select node</option>
                {cluster.nodes.map((node) => (
                  <option key={node.node_id} value={node.node_id}>
                    {node.node_id}
                  </option>
                ))}
              </select>
              <input
                value={allocationForm.start_layer}
                onChange={(event) => setAllocationForm((v) => ({ ...v, start_layer: event.target.value }))}
                placeholder="start_layer"
                className="px-3 py-2 rounded-lg bg-(--surface) border border-(--border) text-sm"
              />
              <input
                value={allocationForm.end_layer}
                onChange={(event) => setAllocationForm((v) => ({ ...v, end_layer: event.target.value }))}
                placeholder="end_layer"
                className="px-3 py-2 rounded-lg bg-(--surface) border border-(--border) text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={savingAllocation || !scopeModelId.trim()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-(--hl1) text-white text-sm disabled:opacity-60"
            >
              {savingAllocation ? <Activity className="h-4 w-4 animate-spin" /> : null}
              Save Allocation
            </button>
          </form>

          <div className="rounded-lg border border-(--border) bg-(--bg) p-4 space-y-3">
            <div className="text-sm">Topology</div>
            {!scopeModelId.trim() ? (
              <p className="text-xs text-(--dim)">Set a model scope to load topology and allocations.</p>
            ) : cluster.topology ? (
              <div className="space-y-2 text-xs">
                <div>
                  Contiguous:{" "}
                  <span className={cluster.topology.contiguous ? "text-emerald-300" : "text-amber-300"}>
                    {cluster.topology.contiguous === null
                      ? "unknown (missing total_layers)"
                      : cluster.topology.contiguous
                        ? "yes"
                        : "no"}
                  </span>
                </div>
                <div>Issues: {cluster.topology.issues.length}</div>
                <div className="text-(--dim)">
                  Last updated: {formatTime(cluster.status?.updated_at)}
                </div>
              </div>
            ) : (
              <p className="text-xs text-(--dim)">No topology data available.</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-(--border) bg-(--bg) overflow-hidden">
          <div className="px-4 py-3 border-b border-(--border) text-sm">
            Allocations {scopeModelId.trim() ? `(${scopeModelId.trim()})` : ""}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-(--dim) border-b border-(--border)">
                  <th className="text-left py-2 px-4">Node</th>
                  <th className="text-left py-2 px-4">Range</th>
                  <th className="text-left py-2 px-4">Updated</th>
                  <th className="text-left py-2 px-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {cluster.allocations.map((allocation, index) => (
                  <tr
                    key={`${allocation.model_id}:${allocation.node_id}`}
                    className={index > 0 ? "border-t border-(--border)/50" : ""}
                  >
                    <td className="py-2 px-4 font-mono text-xs">{allocation.node_id}</td>
                    <td className="py-2 px-4 text-xs">
                      [{allocation.start_layer}, {allocation.end_layer})
                    </td>
                    <td className="py-2 px-4 text-xs">{formatTime(allocation.updated_at)}</td>
                    <td className="py-2 px-4">
                      <button
                        onClick={() => void handleClearAllocation(allocation.node_id)}
                        className="px-2 py-1 rounded border border-(--border) text-xs hover:bg-(--surface)"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {cluster.allocations.length === 0 ? (
                  <tr>
                    <td className="py-4 px-4 text-(--dim)" colSpan={4}>
                      No allocations for current model scope.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-(--border) bg-(--bg) p-4">
          <div className="text-sm mb-2">Topology Issues</div>
          {!cluster.topology || cluster.topology.issues.length === 0 ? (
            <p className="text-xs text-(--dim)">No gap/overlap issues reported.</p>
          ) : (
            <div className="space-y-2">
              {cluster.topology.issues.map((issue, index) => (
                <div
                  key={`${issue.type}:${issue.start_layer}:${issue.end_layer}:${index}`}
                  className="rounded border border-amber-400/30 bg-amber-400/10 p-2 text-xs"
                >
                  <div className="uppercase tracking-wide text-amber-300">{issue.type}</div>
                  <div>
                    [{issue.start_layer}, {issue.end_layer})
                  </div>
                  {issue.nodes?.length ? <div>nodes: {issue.nodes.join(", ")}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
