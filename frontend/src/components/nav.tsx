'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Layers,
  FileText,
  Settings,
  MessageSquare,
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
} from 'lucide-react';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { CommandPalette, type CommandPaletteAction } from '@/components/command-palette';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, description: 'System status & overview' },
  { href: '/chat', label: 'Chat', icon: MessageSquare, description: 'Talk to your models' },
  { href: '/recipes', label: 'Recipes', icon: Settings, description: 'Model configurations' },
  { href: '/logs', label: 'Logs', icon: FileText, description: 'View backend logs' },
  { href: '/usage', label: 'Usage', icon: BarChart3, description: 'Token analytics' },
  { href: '/configs', label: 'Configs', icon: Settings, description: 'System configuration' },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const isChatPage = pathname === '/chat';
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [status, setStatus] = useState<{ online: boolean; inferenceOnline: boolean; model?: string }>({
    online: false,
    inferenceOnline: false,
  });

  useEffect(() => {
    try {
      const k = window.localStorage.getItem('vllmstudio_api_key') || '';
      setApiKeySet(Boolean(k));
    } catch {
      setApiKeySet(false);
    }
  }, []);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const health = await api.getHealth();
        setStatus({
          // Controller reachability
          online: health.status === 'ok',
          // Inference reachability (vLLM/SGLang on :8000)
          inferenceOnline: health.backend_reachable,
          model: health.running_model?.split('/').pop(),
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
    if (!confirm('Stop the current model?')) return;
    try {
      await api.evictModel(true);
      window.location.reload();
    } catch (e) {
      alert('Failed to stop model: ' + (e as Error).message);
    }
    setActionsOpen(false);
  };

  const handleExport = async () => {
    try {
      const data = await api.exportRecipes();
      const blob = new Blob([JSON.stringify(data.content, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vllm-recipes.json';
      a.click();
    } catch (e) {
      alert('Export failed: ' + (e as Error).message);
    }
    setActionsOpen(false);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
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
        alert('Import failed: ' + (e as Error).message);
      }
    };
    input.click();
    setActionsOpen(false);
  };

  const handleApiKeySave = () => {
    try {
      const trimmed = apiKeyValue.trim();
      if (trimmed) {
        window.localStorage.setItem('vllmstudio_api_key', trimmed);
        setApiKeySet(true);
      } else {
        window.localStorage.removeItem('vllmstudio_api_key');
        setApiKeySet(false);
      }
      setApiKeyOpen(false);
      setApiKeyValue('');
      window.location.reload();
    } catch (e) {
      alert('Failed to save key: ' + (e as Error).message);
    }
  };

  const handleApiKeyClear = () => {
    try {
      window.localStorage.removeItem('vllmstudio_api_key');
      setApiKeySet(false);
      setApiKeyOpen(false);
      setApiKeyValue('');
      window.location.reload();
    } catch (e) {
      alert('Failed to clear key: ' + (e as Error).message);
    }
  };

  const actions: CommandPaletteAction[] = [
    {
      id: 'go-dashboard',
      label: 'Go to Dashboard',
      hint: '/',
      keywords: ['home', 'status'],
      run: () => router.push('/'),
    },
    {
      id: 'go-chat',
      label: 'Go to Chat',
      hint: '/chat',
      keywords: ['assistant', 'messages'],
      run: () => router.push('/chat'),
    },
    {
      id: 'go-recipes',
      label: 'Go to Recipes',
      hint: '/recipes',
      keywords: ['launch', 'config'],
      run: () => router.push('/recipes'),
    },
    {
      id: 'go-usage',
      label: 'Go to Usage',
      hint: '/usage',
      keywords: ['analytics', 'tokens', 'stats'],
      run: () => router.push('/usage'),
    },
    {
      id: 'go-configs',
      label: 'Go to Configs',
      hint: '/configs',
      keywords: ['settings', 'configuration', 'system', 'topology'],
      run: () => router.push('/configs'),
    },
    {
      id: 'go-logs',
      label: 'Go to Logs',
      hint: '/logs',
      keywords: ['tail', 'errors'],
      run: () => router.push('/logs'),
    },
    {
      id: 'go-models',
      label: 'Go to Models',
      hint: '/models',
      keywords: ['list', 'discover'],
      run: () => router.push('/models'),
    },
    {
      id: 'refresh',
      label: 'Refresh page',
      hint: 'Reload UI',
      keywords: ['reload'],
      run: () => window.location.reload(),
    },
    {
      id: 'stop-model',
      label: 'Stop current model',
      hint: 'Evict backend model',
      keywords: ['evict', 'kill', 'stop'],
      run: async () => {
        if (!confirm('Stop the current model?')) return;
        await api.evictModel(true);
        window.location.reload();
      },
    },
    {
      id: 'export-recipes',
      label: 'Export recipes',
      hint: 'Download JSON',
      keywords: ['backup'],
      run: handleExport,
    },
    {
      id: 'import-recipes',
      label: 'Import recipes',
      hint: 'Upload JSON',
      keywords: ['restore'],
      run: handleImport,
    },
    {
      id: 'set-api-key',
      label: apiKeySet ? 'Update API key' : 'Set API key',
      hint: 'Browser only',
      keywords: ['auth', 'token', 'security'],
      run: () => setApiKeyOpen(true),
    },
  ];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isK = e.key.toLowerCase() === 'k';
      const cmdk = (e.metaKey || e.ctrlKey) && isK;
      if (cmdk) {
        e.preventDefault();
        setPaletteOpen(true);
        setActionsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Hide nav on mobile when on chat page (chat page has its own unified header)
  if (isChatPage && isMobile) {
    return (
      <>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          actions={actions}
          statusText={
            status.online
              ? (status.inferenceOnline
                  ? `Controller online • Inference online • ${status.model || 'model unknown'}`
                  : `Controller online • Inference offline • ${status.model || 'no model loaded'}`)
              : 'Controller offline'
          }
        />
        {apiKeyOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">API Key</div>
                <button
                  onClick={() => {
                    setApiKeyOpen(false);
                    setApiKeyValue('');
                  }}
                  className="p-1 rounded hover:bg-[var(--card-hover)]"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 text-xs text-[#b0a8a0]">
                Stored locally in your browser and sent as <code className="font-mono">Authorization: Bearer</code>.
              </p>
              <input
                className="mt-3 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm font-mono"
                placeholder={apiKeySet ? 'Enter new key (leave blank to clear)' : 'Enter API key'}
                value={apiKeyValue}
                onChange={(e) => setApiKeyValue(e.target.value)}
                type="password"
                autoFocus
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  onClick={handleApiKeyClear}
                  className="px-3 py-2 text-sm rounded-md border border-[var(--border)] hover:bg-[var(--card-hover)]"
                  type="button"
                >
                  Clear
                </button>
                <button
                  onClick={handleApiKeySave}
                  className="px-3 py-2 text-sm rounded-md bg-[var(--accent)] text-[var(--foreground)] hover:opacity-90"
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
            ? (status.inferenceOnline
                ? `Controller online • Inference online • ${status.model || 'model unknown'}`
                : `Controller online • Inference offline • ${status.model || 'no model loaded'}`)
            : 'Controller offline'
        }
      />

      {apiKeyOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium">API Key</div>
              <button
                onClick={() => {
                  setApiKeyOpen(false);
                  setApiKeyValue('');
                }}
                className="p-1 rounded hover:bg-[var(--card-hover)]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-[#b0a8a0]">
              Stored locally in your browser and sent as <code className="font-mono">Authorization: Bearer</code>.
            </p>
            <input
              className="mt-3 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm font-mono"
              placeholder={apiKeySet ? 'Enter new key (leave blank to clear)' : 'Enter API key'}
              value={apiKeyValue}
              onChange={(e) => setApiKeyValue(e.target.value)}
              type="password"
              autoFocus
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                onClick={handleApiKeyClear}
                className="px-3 py-2 text-sm rounded-md border border-[var(--border)] hover:bg-[var(--card-hover)]"
                type="button"
              >
                Clear
              </button>
              <button
                onClick={handleApiKeySave}
                className="px-3 py-2 text-sm rounded-md bg-[var(--accent)] text-[var(--foreground)] hover:opacity-90"
                type="button"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-[var(--card)] pt-[env(safe-area-inset-top,0)]">
        <div className="flex h-12 md:h-14 items-center justify-between px-3 md:px-4 border-b border-[var(--border)]">
          {/* Logo & Nav Links */}
          <div className="flex items-center gap-3 md:gap-6">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-1.5 -ml-1.5 rounded-lg hover:bg-[var(--accent)] transition-colors"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <Link href="/" className="flex items-center gap-2 font-semibold">
              <Layers className="h-5 w-5 text-[var(--accent)]" />
              <span className="hidden sm:inline">vLLM Studio</span>
            </Link>

            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                      isActive
                        ? 'bg-[var(--card-hover)] text-[var(--foreground)]'
                        : 'text-[#b0a8a0] hover:text-[var(--foreground)] hover:bg-[var(--card-hover)]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-2 md:gap-3">
            {/* Status - shown on all screens */}
            <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${status.online ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`} />
              <span className="text-[#b0a8a0] truncate max-w-[100px] md:max-w-none">
                {status.inferenceOnline ? (status.model || 'Ready') : status.online ? 'No model' : 'Offline'}
              </span>
            </div>

            <button
              onClick={() => setApiKeyOpen(true)}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 text-sm border border-[var(--border)] rounded-md hover:bg-[var(--card-hover)] transition-colors"
              title={apiKeySet ? 'API key set (click to update)' : 'Set API key'}
            >
              <Key className="h-4 w-4" />
              {apiKeySet ? 'Key' : 'Set Key'}
            </button>

            <button
              onClick={() => setPaletteOpen(true)}
              className="p-2 md:hidden rounded-md hover:bg-[var(--card-hover)] transition-colors"
              title="Search"
            >
              <Search className="h-4 w-4 text-[#b0a8a0]" />
            </button>

            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 text-sm border border-[var(--border)] rounded-md hover:bg-[var(--card-hover)] transition-colors"
              title="Command palette (Ctrl/⌘K)"
            >
              <Search className="h-4 w-4" />
              <span className="text-[#b0a8a0]">Search</span>
              <span className="ml-1 text-[10px] font-mono text-[#9a9590] border border-[var(--border)] rounded px-1.5 py-0.5">
                ⌘K
              </span>
            </button>

            {/* Actions Dropdown */}
            <div className="relative hidden md:block">
              <button
                onClick={() => setActionsOpen(!actionsOpen)}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-[var(--border)] rounded-md hover:bg-[var(--card-hover)] transition-colors"
              >
                Actions
                <Menu className="h-4 w-4" />
              </button>

              {actionsOpen && (
                <>
                  <div className="fixed inset-0" onClick={() => setActionsOpen(false)} />
                  <div className="absolute right-0 mt-2 w-48 bg-[var(--card)] border border-[var(--border)] rounded-md shadow-lg z-50">
                    <button
                      onClick={handleRefresh}
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-[var(--card-hover)]"
                    >
                      <RefreshCw className="h-4 w-4" /> Refresh
                    </button>
                    <button
                      onClick={handleEvict}
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-[var(--card-hover)]"
                    >
                      <Square className="h-4 w-4" /> Stop Model
                    </button>
                    <div className="border-t border-[var(--border)]" />
                    <button
                      onClick={handleExport}
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-[var(--card-hover)]"
                    >
                      <Download className="h-4 w-4" /> Export Recipes
                    </button>
                    <button
                      onClick={handleImport}
                      className="flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-[var(--card-hover)]"
                    >
                      <Upload className="h-4 w-4" /> Import Recipes
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
        <div className="md:hidden fixed inset-0 z-[60]">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 animate-fade-in"
            onClick={() => setMobileMenuOpen(false)}
          />
          {/* Drawer */}
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-[var(--card)] border-r border-[var(--border)] animate-slide-in-left">
            {/* Header */}
            <div className="flex items-center justify-between p-4 pt-[calc(1rem+env(safe-area-inset-top,0))] border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-[var(--accent)]" />
                <span className="font-semibold">vLLM Studio</span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-lg hover:bg-[var(--accent)] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Status */}
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${status.online ? 'bg-[var(--success)]' : 'bg-[var(--error)]'}`} />
                <span className="text-sm text-[#b0a8a0]">
                  {status.inferenceOnline ? (status.model || 'No model') : status.online ? 'Inference offline' : 'Offline'}
                </span>
              </div>
            </div>

            {/* Navigation */}
            <nav className="p-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-[var(--accent)] text-[var(--foreground)]'
                        : 'text-[#b0a8a0] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <div className="flex-1">
                      <div className="font-medium">{item.label}</div>
                      <div className="text-xs text-[#9a9590]">{item.description}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[#9a9590]" />
                  </Link>
                );
              })}
            </nav>

            {/* Actions */}
            <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-[var(--border)] bg-[var(--card)]">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setApiKeyOpen(true);
                  }}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors"
                >
                  <Key className="h-4 w-4" />
                  {apiKeySet ? 'Key Set' : 'API Key'}
                </button>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setPaletteOpen(true);
                  }}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--card-hover)] transition-colors"
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
