// CRITICAL
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Layers,
  FileText,
  Settings2,
  MessageSquareText,
  Key,
  Menu,
  X,
  RefreshCw,
  Square,
  Download,
  Upload,
  Search,
  ChevronRight,
  BarChart3,
  Cpu,
  ScrollText,
  Sparkles,
  Zap,
  Compass,
  Terminal,
} from "lucide-react";
import { useState, useEffect } from "react";
import api from "@/lib/api";
import { getApiKey, setApiKey, clearApiKey } from "@/lib/api-key";
import { CommandPalette, type CommandPaletteAction } from "@/components/command-palette";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, description: "Overview & status", color: "from-blue-500/20 to-cyan-500/20" },
  { href: "/chat", label: "Chat", icon: MessageSquareText, description: "Talk to models", color: "from-violet-500/20 to-purple-500/20" },
  { href: "/recipes", label: "Recipes", icon: Sparkles, description: "Model configs", color: "from-amber-500/20 to-orange-500/20" },
  { href: "/logs", label: "Logs", icon: ScrollText, description: "Backend logs", color: "from-emerald-500/20 to-teal-500/20" },
  { href: "/usage", label: "Usage", icon: BarChart3, description: "Token analytics", color: "from-pink-500/20 to-rose-500/20" },
  { href: "/configs", label: "Configs", icon: Settings2, description: "System settings", color: "from-slate-500/20 to-gray-500/20" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const isChatPage = pathname === "/chat";
  const [actionsOpen, setActionsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [apiKeySet, setApiKeySet] = useState(() => Boolean(getApiKey()));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [status, setStatus] = useState<{
    online: boolean;
    inferenceOnline: boolean;
    model?: string;
  }>({
    online: false,
    inferenceOnline: false,
  });

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const health = await api.getHealth();
        setStatus({
          // Controller reachability
          online: health.status === "ok",
          // Inference reachability (vLLM/SGLang on :8000)
          inferenceOnline: health.backend_reachable,
          model: health.running_model?.split("/").pop(),
        });
      } catch {
        setStatus({ online: false, inferenceOnline: false });
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    window.location.reload();
    setActionsOpen(false);
  };

  const handleEvict = async () => {
    if (!confirm("Stop the current model?")) return;
    try {
      await api.evictModel(true);
      window.location.reload();
    } catch (e) {
      alert("Failed to stop model: " + (e as Error).message);
    }
    setActionsOpen(false);
  };

  const handleExport = async () => {
    try {
      const data = await api.exportRecipes();
      const blob = new Blob([JSON.stringify(data.content, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vllm-recipes.json";
      a.click();
    } catch (e) {
      alert("Export failed: " + (e as Error).message);
    }
    setActionsOpen(false);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const recipes = data.recipes || [data];
        for (const r of recipes) {
          await api.createRecipe(r);
        }
        alert(`Imported ${recipes.length} recipe(s)`);
        window.location.reload();
      } catch (e) {
        alert("Import failed: " + (e as Error).message);
      }
    };
    input.click();
    setActionsOpen(false);
  };

  const handleApiKeySave = () => {
    const trimmed = apiKeyValue.trim();
    setApiKey(trimmed);
    setApiKeySet(Boolean(trimmed));
    setApiKeyOpen(false);
    setApiKeyValue("");
    window.location.reload();
  };

  const handleApiKeyClear = () => {
    clearApiKey();
    setApiKeySet(false);
    setApiKeyOpen(false);
    setApiKeyValue("");
    window.location.reload();
  };

  const actions: CommandPaletteAction[] = [
    {
      id: "go-dashboard",
      label: "Go to Dashboard",
      hint: "/",
      keywords: ["home", "status"],
      run: () => router.push("/"),
    },
    {
      id: "go-chat",
      label: "Go to Chat",
      hint: "/chat",
      keywords: ["assistant", "messages"],
      run: () => router.push("/chat"),
    },
    {
      id: "go-recipes",
      label: "Go to Recipes",
      hint: "/recipes",
      keywords: ["launch", "config"],
      run: () => router.push("/recipes"),
    },
    {
      id: "go-usage",
      label: "Go to Usage",
      hint: "/usage",
      keywords: ["analytics", "tokens", "stats"],
      run: () => router.push("/usage"),
    },
    {
      id: "go-configs",
      label: "Go to Configs",
      hint: "/configs",
      keywords: ["settings", "configuration", "system", "topology"],
      run: () => router.push("/configs"),
    },
    {
      id: "go-logs",
      label: "Go to Logs",
      hint: "/logs",
      keywords: ["tail", "errors"],
      run: () => router.push("/logs"),
    },
    {
      id: "go-models",
      label: "Go to Models",
      hint: "/models",
      keywords: ["list", "discover"],
      run: () => router.push("/models"),
    },
    {
      id: "refresh",
      label: "Refresh page",
      hint: "Reload UI",
      keywords: ["reload"],
      run: () => window.location.reload(),
    },
    {
      id: "stop-model",
      label: "Stop current model",
      hint: "Evict backend model",
      keywords: ["evict", "kill", "stop"],
      run: async () => {
        if (!confirm("Stop the current model?")) return;
        await api.evictModel(true);
        window.location.reload();
      },
    },
    {
      id: "export-recipes",
      label: "Export recipes",
      hint: "Download JSON",
      keywords: ["backup"],
      run: handleExport,
    },
    {
      id: "import-recipes",
      label: "Import recipes",
      hint: "Upload JSON",
      keywords: ["restore"],
      run: handleImport,
    },
    {
      id: "set-api-key",
      label: apiKeySet ? "Update API key" : "Set API key",
      hint: "Browser only",
      keywords: ["auth", "token", "security"],
      run: () => setApiKeyOpen(true),
    },
  ];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isK = e.key.toLowerCase() === "k";
      const cmdk = (e.metaKey || e.ctrlKey) && isK;
      if (cmdk) {
        e.preventDefault();
        setPaletteOpen(true);
        setActionsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Hide nav completely on chat page (sidebar has all navigation)
  if (isChatPage) {
    return (
      <>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          actions={actions}
          statusText={
            status.online
              ? status.inferenceOnline
                ? `Controller online • Inference online • ${status.model || "model unknown"}`
                : `Controller online • Inference offline • ${status.model || "no model loaded"}`
              : "Controller offline"
          }
        />
        {apiKeyOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-lg border border-(--border) bg-(--card) p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">API Key</div>
                <button
                  onClick={() => {
                    setApiKeyOpen(false);
                    setApiKeyValue("");
                  }}
                  className="p-1 rounded hover:bg-(--card-hover)"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 text-xs text-[#b0a8a0]">
                Stored locally in your browser and sent as{" "}
                <code className="font-mono">Authorization: Bearer</code>.
              </p>
              <input
                className="mt-3 w-full rounded-md border border-(--border) bg-transparent px-3 py-2 text-sm font-mono"
                placeholder={apiKeySet ? "Enter new key (leave blank to clear)" : "Enter API key"}
                value={apiKeyValue}
                onChange={(e) => setApiKeyValue(e.target.value)}
                type="password"
                autoFocus
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  onClick={handleApiKeyClear}
                  className="px-3 py-2 text-sm rounded-md border border-(--border) hover:bg-(--card-hover)"
                  type="button"
                >
                  Clear
                </button>
                <button
                  onClick={handleApiKeySave}
                  className="px-3 py-2 text-sm rounded-md bg-(--accent) text-foreground hover:opacity-90"
                  type="button"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={actions}
        statusText={
          status.online
            ? status.inferenceOnline
              ? `Controller online • Inference online • ${status.model || "model unknown"}`
              : `Controller online • Inference offline • ${status.model || "no model loaded"}`
            : "Controller offline"
        }
      />

      {apiKeyOpen ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-(--border) bg-(--card) p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium">API Key</div>
              <button
                onClick={() => {
                  setApiKeyOpen(false);
                  setApiKeyValue("");
                }}
                className="p-1 rounded hover:bg-(--card-hover)"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-[#b0a8a0]">
              Stored locally in your browser and sent as{" "}
              <code className="font-mono">Authorization: Bearer</code>.
            </p>
            <input
              className="mt-3 w-full rounded-md border border-(--border) bg-transparent px-3 py-2 text-sm font-mono"
              placeholder={apiKeySet ? "Enter new key (leave blank to clear)" : "Enter API key"}
              value={apiKeyValue}
              onChange={(e) => setApiKeyValue(e.target.value)}
              type="password"
              autoFocus
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                onClick={handleApiKeyClear}
                className="px-3 py-2 text-sm rounded-md border border-(--border) hover:bg-(--card-hover)"
                type="button"
              >
                Clear
              </button>
              <button
                onClick={handleApiKeySave}
                className="px-3 py-2 text-sm rounded-md bg-(--accent) text-foreground hover:opacity-90"
                type="button"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/80 backdrop-blur-xl pt-[env(safe-area-inset-top,0)] border-b border-white/[0.06]">
        <div className="flex h-12 md:h-14 items-center justify-between px-3 md:px-4">
          {/* Logo & Nav Links */}
          <div className="flex items-center gap-3 md:gap-5">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 -ml-1.5 rounded-xl hover:bg-white/[0.08] transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <Link href="/" className="flex items-center gap-2.5 font-semibold group">
              <div className="relative">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:shadow-purple-500/30 transition-shadow">
                  <Layers className="h-4 w-4 text-white" />
                </div>
                <div className="absolute -inset-0.5 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg blur opacity-20 group-hover:opacity-30 transition-opacity" />
              </div>
              <span className="hidden sm:inline text-foreground">vLLM Studio</span>
            </Link>

            <nav className="hidden md:flex items-center gap-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 group ${
                      isActive
                        ? "text-foreground"
                        : "text-[#a0a0a0] hover:text-foreground"
                    }`}
                  >
                    {/* Active background */}
                    {isActive && (
                      <>
                        <div className={`absolute inset-0 bg-gradient-to-r ${item.color} rounded-lg opacity-60`} />
                        <div className="absolute inset-0 bg-white/[0.05] backdrop-blur-sm rounded-lg" />
                      </>
                    )}
                    <Icon className={`h-4 w-4 relative z-10 transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-105'}`} />
                    <span className="relative z-10 font-medium">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-1.5 md:gap-2">
            {/* Status - shown on all screens */}
            <div className="flex items-center gap-2 text-xs md:text-sm px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <div className={`relative flex items-center justify-center ${status.inferenceOnline ? 'text-emerald-400' : status.online ? 'text-amber-400' : 'text-red-400'}`}>
                <div className={`w-2 h-2 rounded-full ${status.inferenceOnline ? 'bg-emerald-400' : status.online ? 'bg-amber-400' : 'bg-red-400'} ${status.inferenceOnline ? 'animate-pulse' : ''}`} />
                {status.inferenceOnline && (
                  <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-400 animate-ping opacity-30" />
                )}
              </div>
              <span className="text-[#a0a0a0] truncate max-w-24 md:max-w-32 font-medium">
                {status.inferenceOnline
                  ? status.model || "Ready"
                  : status.online
                    ? "No model"
                    : "Offline"}
              </span>
            </div>

            <button
              onClick={() => setApiKeyOpen(true)}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 text-sm bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.12] rounded-lg transition-all duration-200"
              title={apiKeySet ? "API key set (click to update)" : "Set API key"}
            >
              <Key className="h-4 w-4 text-[#a0a0a0]" />
              <span className="text-[#a0a0a0]">{apiKeySet ? "Key" : "Set Key"}</span>
            </button>

            <button
              onClick={() => setPaletteOpen(true)}
              className="p-2 md:hidden rounded-lg hover:bg-white/[0.08] transition-colors"
              title="Search"
            >
              <Search className="h-4 w-4 text-[#888]" />
            </button>

            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 text-sm bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.12] rounded-lg transition-all duration-200"
              title="Command palette (Ctrl/⌘K)"
            >
              <Search className="h-4 w-4 text-[#a0a0a0]" />
              <span className="text-[#a0a0a0]">Search</span>
              <span className="ml-1 text-[10px] font-mono text-[#666] bg-white/[0.05] border border-white/[0.08] rounded px-1.5 py-0.5">
                ⌘K
              </span>
            </button>

            {/* Actions Dropdown */}
            <div className="relative hidden md:block">
              <button
                onClick={() => setActionsOpen(!actionsOpen)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.12] rounded-lg transition-all duration-200"
              >
                <span className="text-[#a0a0a0]">Actions</span>
                <Menu className="h-4 w-4 text-[#888]" />
              </button>

              {actionsOpen && (
                <>
                  <div className="fixed inset-0" onClick={() => setActionsOpen(false)} />
                  <div className="absolute right-0 mt-2 w-52 bg-[#111111]/95 backdrop-blur-xl border border-white/[0.08] rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden py-1">
                    <button
                      onClick={handleRefresh}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm hover:bg-white/[0.05] transition-colors group"
                    >
                      <RefreshCw className="h-4 w-4 text-[#666] group-hover:text-[#888]" /> 
                      <span className="text-[#a0a0a0] group-hover:text-foreground">Refresh</span>
                    </button>
                    <button
                      onClick={handleEvict}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm hover:bg-white/[0.05] transition-colors group"
                    >
                      <Square className="h-4 w-4 text-red-400/70 group-hover:text-red-400" /> 
                      <span className="text-red-400/70 group-hover:text-red-400">Stop Model</span>
                    </button>
                    <div className="border-t border-white/[0.06] my-1" />
                    <button
                      onClick={handleExport}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm hover:bg-white/[0.05] transition-colors group"
                    >
                      <Download className="h-4 w-4 text-[#666] group-hover:text-[#888]" /> 
                      <span className="text-[#a0a0a0] group-hover:text-foreground">Export Recipes</span>
                    </button>
                    <button
                      onClick={handleImport}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm hover:bg-white/[0.05] transition-colors group"
                    >
                      <Upload className="h-4 w-4 text-[#666] group-hover:text-[#888]" /> 
                      <span className="text-[#a0a0a0] group-hover:text-foreground">Import Recipes</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Slide-out Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-60">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 animate-fade-in"
            onClick={() => setMobileMenuOpen(false)}
          />
          {/* Drawer */}
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-[#0a0a0a]/95 backdrop-blur-xl border-r border-white/[0.06] animate-slide-in-left shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-4 pt-[calc(1rem+env(safe-area-inset-top,0))] border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                    <Layers className="h-5 w-5 text-white" />
                  </div>
                  <div className="absolute -inset-0.5 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-xl blur opacity-30" />
                </div>
                <div>
                  <span className="font-semibold text-foreground">vLLM Studio</span>
                  <div className="text-[10px] text-[#666] font-medium tracking-wide">AI INFERENCE</div>
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-xl hover:bg-white/[0.08] transition-colors"
              >
                <X className="h-5 w-5 text-[#888]" />
              </button>
            </div>

            {/* Status */}
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div className={`relative flex items-center justify-center ${status.inferenceOnline ? 'text-emerald-400' : status.online ? 'text-amber-400' : 'text-red-400'}`}>
                  <div className={`w-2.5 h-2.5 rounded-full ${status.inferenceOnline ? 'bg-emerald-400' : status.online ? 'bg-amber-400' : 'bg-red-400'} ${status.inferenceOnline ? 'animate-pulse' : ''}`} />
                  {status.inferenceOnline && (
                    <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-30" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {status.inferenceOnline
                      ? status.model || "Ready"
                      : status.online
                        ? "Inference offline"
                        : "Offline"}
                  </div>
                  <div className="text-xs text-[#666]">
                    {status.online ? "Controller online" : "Controller offline"}
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <nav className="p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`group flex items-center gap-3.5 px-3 py-3 rounded-xl transition-all duration-200 relative overflow-hidden ${
                      isActive
                        ? "text-foreground"
                        : "text-[#a0a0a0] hover:text-foreground hover:bg-white/[0.03]"
                    }`}
                  >
                    {/* Active background gradient */}
                    {isActive && (
                      <>
                        <div className={`absolute inset-0 bg-gradient-to-r ${item.color} opacity-50`} />
                        <div className="absolute inset-0 bg-white/[0.05] backdrop-blur-sm" />
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-gradient-to-b from-white/80 to-white/40 rounded-r-full" />
                      </>
                    )}
                    
                    <span className="relative z-10">
                      <Icon className={`h-5 w-5 transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-105'}`} />
                    </span>
                    <div className="flex-1 relative z-10">
                      <div className="font-medium text-sm">{item.label}</div>
                      <div className={`text-xs ${isActive ? 'text-white/60' : 'text-[#666]'}`}>{item.description}</div>
                    </div>
                    <ChevronRight className={`h-4 w-4 transition-all duration-200 relative z-10 ${isActive ? 'text-white/60 translate-x-0.5' : 'text-[#444] group-hover:text-[#666] group-hover:translate-x-0.5'}`} />
                  </Link>
                );
              })}
            </nav>

            {/* Actions */}
            <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-(--border) bg-(--card)">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setApiKeyOpen(true);
                  }}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 text-sm border border-(--border) rounded-lg hover:bg-(--card-hover) transition-colors"
                >
                  <Key className="h-4 w-4" />
                  {apiKeySet ? "Key Set" : "API Key"}
                </button>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setPaletteOpen(true);
                  }}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 text-sm border border-(--border) rounded-lg hover:bg-(--card-hover) transition-colors"
                >
                  <Search className="h-4 w-4" />
                  Search
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
