"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Eye, EyeOff, Loader2, Pencil, Plus, Power, PowerOff, Trash2, X } from "lucide-react";
import api from "@/lib/api";

interface ProviderEntry {
  id: string;
  name: string;
  base_url: string;
  enabled: boolean;
  has_api_key: boolean;
}

const WELL_KNOWN_PROVIDERS: Record<string, { name: string; baseUrl: string }> = {
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1/models" },
  anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1/models" },
};

const WELL_KNOWN_IDS = Object.keys(WELL_KNOWN_PROVIDERS);

export function ProvidersSection() {
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [showFormApiKey, setShowFormApiKey] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<ProviderEntry | null>(null);
  const [editApiKey, setEditApiKey] = useState("");
  const [showEditApiKey, setShowEditApiKey] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const loadProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.getProviders();
      setProviders(result.providers);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const resetForm = () => {
    setFormId("");
    setFormName("");
    setFormBaseUrl("");
    setFormApiKey("");
    setShowFormApiKey(false);
    setAdding(false);
    setEditingProvider(null);
  };

  const handleQuickAdd = (knownId: string) => {
    const known = WELL_KNOWN_PROVIDERS[knownId];
    if (!known) return;
    setFormId(knownId);
    setFormName(known.name);
    setFormBaseUrl(known.baseUrl);
    setFormApiKey("");
    setAdding(true);
  };

  const handleCreate = async () => {
    if (!formId.trim() || !formName.trim() || !formBaseUrl.trim()) return;
    try {
      setSaving(true);
      setError(null);
      await api.updateProvider(
        formId.trim().toLowerCase(),
        {
          name: formName.trim(),
          base_url: formBaseUrl.trim(),
          api_key: formApiKey.trim(),
        }
      );
      resetForm();
      setEditingProvider(null);
      await loadProviders();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (provider: ProviderEntry) => {
    try {
      await api.updateProvider(provider.id, { enabled: !provider.enabled });
      await loadProviders();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteProvider(id);
      await loadProviders();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleEdit = (provider: ProviderEntry) => {
    setFormId(provider.id);
    setFormName(provider.name);
    setFormBaseUrl(provider.base_url);
    setFormApiKey("");
    setAdding(true);
    setEditingProvider(provider);
  };

  const handleUpdateApiKey = async (id: string) => {
    try {
      setEditSaving(true);
      await api.updateProvider(id, { api_key: editApiKey.trim() });
      setEditingId(null);
      setEditApiKey("");
      setShowEditApiKey(false);
      await loadProviders();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEditSaving(false);
    }
  };

  const availableQuickAdds = WELL_KNOWN_IDS.filter(
    (knownId) => !providers.some((p) => p.id === knownId)
  );

  return (
    <div className="mb-6 sm:mb-8">
      <div className="text-xs text-(--dim) uppercase tracking-wider mb-3">Providers</div>
      <p className="text-xs text-(--dim) mb-4">
        Configure external LLM providers to use their models alongside your local inference backend.
        Models will appear in the chat model selector as <code className="text-(--fg)">provider/model-name</code>.
      </p>

      <div className="bg-(--surface) rounded-lg p-4 sm:p-6 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 text-(--dim) animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-xs text-(--err) bg-(--err)/10 rounded px-3 py-2">{error}</div>
        )}

        {!loading && providers.length === 0 && !adding && (
          <div className="text-center py-6 text-xs text-(--dim)">
            No providers configured. Add one below to get started.
          </div>
        )}

        {!loading &&
          providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center gap-3 bg-(--bg) border border-(--border) rounded-lg px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-(--fg) truncate">{provider.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-(--border) text-(--dim)">
                    {provider.id}
                  </span>
                  {provider.enabled ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-(--hl2)/15 text-(--hl2)">
                      active
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-(--dim)/15 text-(--dim)">
                      disabled
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-(--dim) mt-0.5 truncate">{provider.base_url}</div>

                {editingId === provider.id ? (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showEditApiKey ? "text" : "password"}
                        value={editApiKey}
                        onChange={(e) => setEditApiKey(e.target.value)}
                        placeholder={provider.has_api_key ? "••••••••" : "Enter API key"}
                        className="w-full px-2 py-1.5 pr-8 bg-(--surface) border border-(--border) rounded text-xs text-(--fg) placeholder-(--dim)/50 focus:outline-none focus:border-(--hl1)"
                      />
                      <button
                        type="button"
                        onClick={() => setShowEditApiKey(!showEditApiKey)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-(--dim) hover:text-(--fg)"
                      >
                        {showEditApiKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    </div>
                    <button
                      onClick={() => handleUpdateApiKey(provider.id)}
                      disabled={editSaving}
                      className="px-2 py-1.5 bg-(--hl1) rounded text-[11px] text-(--fg) hover:opacity-90 disabled:opacity-50"
                    >
                      {editSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setEditApiKey("");
                        setShowEditApiKey(false);
                      }}
                      className="px-2 py-1.5 bg-(--border) rounded text-[11px] text-(--dim) hover:text-(--fg)"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingId(provider.id);
                      setEditApiKey("");
                      setShowEditApiKey(false);
                    }}
                    className="mt-1 text-[11px] text-(--hl1) hover:underline"
                  >
                    {provider.has_api_key ? "Update API key" : "Set API key"}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleToggle(provider)}
                  title={provider.enabled ? "Disable" : "Enable"}
                  className="p-1.5 rounded hover:bg-(--border) text-(--dim) hover:text-(--fg)"
                >
                  {provider.enabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => handleEdit(provider)}
                  title="Edit"
                  className="p-1.5 rounded hover:bg-(--border) text-(--dim) hover:text-(--fg)"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(provider.id)}
                  title="Remove"
                  className="p-1.5 rounded hover:bg-(--err)/10 text-(--dim) hover:text-(--err)"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

        {adding && (
          <div className="bg-(--bg) border border-(--hl1)/30 rounded-lg p-4 space-y-3">
            <div className="text-xs font-medium text-(--fg) mb-2">
              {editingProvider ? `Edit Provider: ${editingProvider.name}` : "Add Provider"}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-(--dim) mb-1">Provider ID</label>
                <input
                  type="text"
                  value={formId}
                  onChange={(e) => setFormId(e.target.value)}
                  placeholder="e.g. openai"
                  className="w-full px-2 py-1.5 bg-(--surface) border border-(--border) rounded text-xs text-(--fg) placeholder-(--dim)/50 focus:outline-none focus:border-(--hl1)"
                />
              </div>
              <div>
                <label className="block text-[11px] text-(--dim) mb-1">Display Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. OpenAI"
                  className="w-full px-2 py-1.5 bg-(--surface) border border-(--border) rounded text-xs text-(--fg) placeholder-(--dim)/50 focus:outline-none focus:border-(--hl1)"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-(--dim) mb-1">API Models URL</label>
              <input
                type="text"
                value={formBaseUrl}
                onChange={(e) => setFormBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1/models"
                className="w-full px-2 py-1.5 bg-(--surface) border border-(--border) rounded text-xs text-(--fg) placeholder-(--dim)/50 focus:outline-none focus:border-(--hl1)"
              />
            </div>
            <div>
              <label className="block text-[11px] text-(--dim) mb-1">API Key</label>
              <div className="relative">
                <input
                  type={showFormApiKey ? "text" : "password"}
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-2 py-1.5 pr-8 bg-(--surface) border border-(--border) rounded text-xs text-(--fg) placeholder-(--dim)/50 focus:outline-none focus:border-(--hl1)"
                />
                <button
                  type="button"
                  onClick={() => setShowFormApiKey(!showFormApiKey)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-(--dim) hover:text-(--fg)"
                >
                  {showFormApiKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleCreate}
                disabled={saving || !formId.trim() || !formName.trim() || !formBaseUrl.trim()}
                className="px-3 py-1.5 bg-(--hl1) rounded-lg text-xs text-(--fg) hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                {editingProvider ? "Save" : "Add"}
              </button>
              <button
                onClick={resetForm}
                className="px-3 py-1.5 bg-(--border) rounded-lg text-xs text-(--dim) hover:text-(--fg)"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!adding && (
          <div className="flex items-center gap-2 pt-1">
            {availableQuickAdds.map((knownId) => (
              <button
                key={knownId}
                onClick={() => handleQuickAdd(knownId)}
                className="px-3 py-1.5 bg-(--border) rounded-lg text-xs text-(--fg) hover:bg-(--surface) flex items-center gap-1.5"
              >
                <Plus className="h-3 w-3" />
                {WELL_KNOWN_PROVIDERS[knownId].name}
              </button>
            ))}
            <button
              onClick={() => setAdding(true)}
              className="px-3 py-1.5 bg-(--border) rounded-lg text-xs text-(--dim) hover:text-(--fg) flex items-center gap-1.5"
            >
              <Plus className="h-3 w-3" />
              Custom
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
