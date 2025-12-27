'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Square,
  Copy,
  Check,
  Download,
  Maximize2,
  Minimize2,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

interface CodeSandboxProps {
  code: string;
  language: 'html' | 'react' | 'javascript';
  title?: string;
  autoRun?: boolean;
  onOutput?: (output: string) => void;
  onError?: (error: string) => void;
}

const transformReactCode = (code: string) => {
  let transformed = code || '';
  // Strip common import/export patterns that won't work in a plain iframe without bundling.
  transformed = transformed.replace(/^\s*import\s+.*?;?\s*$/gm, '');
  transformed = transformed.replace(/^\s*export\s+\{[^}]+\}\s*;?\s*$/gm, '');
  transformed = transformed.replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, '$1 ');
  // Capture default export into a known global.
  transformed = transformed.replace(/\bexport\s+default\s+/g, 'window.__DEFAULT_EXPORT__ = ');
  return transformed.trim();
};

// Template for React execution
const REACT_TEMPLATE = (code: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; padding: 16px; }
    .error { color: #b91c1c; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="error" class="error" style="display:none;"></div>
  <script type="text/babel" data-presets="react,typescript">
    (() => {
      const send = (type, message) => {
        try { window.parent && window.parent.postMessage({ type, message }, '*'); } catch {}
      };
      const showError = (message) => {
        const el = document.getElementById('error');
        if (el) {
          el.style.display = 'block';
          el.textContent = message;
        }
      };

      window.addEventListener('error', (event) => {
        const msg = event?.error?.stack || event?.message || 'Unknown error';
        send('error', msg);
        showError(msg);
      });

      try {
        window.__DEFAULT_EXPORT__ = undefined;

        const { useState, useEffect, useMemo, useRef, useCallback } = React;

        ${transformReactCode(code)}

        // Try to render common component patterns
        const container = document.getElementById('root');
        const root = ReactDOM.createRoot(container);

        const candidate =
          (typeof App !== 'undefined' && App) ||
          window.__DEFAULT_EXPORT__ ||
          null;

        if (!candidate) {
          const msg = 'React preview: define an App component or use export default.';
          send('error', msg);
          showError(msg);
          return;
        }

        const element = React.isValidElement(candidate)
          ? candidate
          : React.createElement(candidate);

        root.render(element);
      } catch (e) {
        const msg = e?.stack || e?.message || 'Failed to render React preview';
        send('error', msg);
        showError(msg);
      }
    })();
  </script>
</body>
</html>
`;

// Template for vanilla JavaScript
const JS_TEMPLATE = (code: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; padding: 16px; }
    #output { white-space: pre-wrap; font-family: monospace; }
  </style>
</head>
<body>
  <div id="output"></div>
  <script>
    const output = document.getElementById('output');
    const send = (type, message) => {
      try { window.parent && window.parent.postMessage({ type, message }, '*'); } catch {}
    };
    const log = (...args) => {
      const line = args.map(a =>
        typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
      ).join(' ') + '\\n';
      output.textContent += line;
      send('output', line);
    };
    console.log = log;
    console.info = log;
    console.warn = log;
    console.error = (...args) => {
      log(...args);
      send('error', args.map(String).join(' '));
    };

    window.addEventListener('error', (event) => {
      const msg = event?.error?.stack || event?.message || 'Unknown error';
      send('error', msg);
    });

    try {
      ${code}
    } catch (e) {
      output.textContent = 'Error: ' + e.message;
      send('error', e?.stack || e?.message || String(e));
    }
  </script>
</body>
</html>
`;

export function CodeSandbox({
  code,
  language,
  title,
  autoRun = false,
  onOutput,
  onError,
}: CodeSandboxProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const getSrcDoc = useCallback(() => {
    switch (language) {
      case 'html':
        return code;
      case 'react':
        return REACT_TEMPLATE(code);
      case 'javascript':
        return JS_TEMPLATE(code);
      default:
        return code;
    }
  }, [code, language]);

  const runCode = useCallback(() => {
    setIsRunning(true);
    setError(null);

    if (iframeRef.current) {
      try {
        iframeRef.current.srcdoc = getSrcDoc();
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'Failed to run code';
        setError(errorMsg);
        onError?.(errorMsg);
      }
    }
  }, [getSrcDoc, onError]);

  const stopCode = useCallback(() => {
    setIsRunning(false);
    if (iframeRef.current) {
      iframeRef.current.srcdoc = '';
    }
  }, []);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const downloadCode = useCallback(() => {
    const blob = new Blob([getSrcDoc()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'artifact'}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [getSrcDoc, title]);

  // Auto-run on mount if enabled
  useEffect(() => {
    if (!autoRun) return;
    const id = window.setTimeout(() => {
      runCode();
    }, 0);
    return () => window.clearTimeout(id);
  }, [autoRun, runCode]);

  // Listen for iframe errors
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'error') {
        setError(event.data.message);
        onError?.(event.data.message);
      } else if (event.data?.type === 'output') {
        onOutput?.(event.data.message);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onError, onOutput]);

  return (
    <>
      {/* Fullscreen backdrop */}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-[100] bg-black/80"
          onClick={() => setIsFullscreen(false)}
        />
      )}
      <div
        className={`rounded-lg border border-[var(--border)] overflow-hidden ${
          isFullscreen
            ? 'fixed inset-0 z-[101] bg-[var(--background)] m-0 rounded-none flex flex-col'
            : ''
        }`}
        style={isFullscreen ? { paddingTop: 'env(safe-area-inset-top, 0)', paddingBottom: 'env(safe-area-inset-bottom, 0)' } : undefined}
      >
      {/* Header */}
      <div className="flex items-center justify-between px-2 md:px-3 py-2 bg-[var(--accent)] border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium truncate">
            {title || `${language.toUpperCase()}`}
          </span>
        </div>

        <div className="flex items-center gap-0.5 md:gap-1">
          {/* Run/Stop - always visible */}
          {isRunning ? (
            <button
              onClick={stopCode}
              className="p-2 md:p-1.5 rounded hover:bg-[var(--error)]/20 text-[var(--error)] transition-colors"
              title="Stop"
            >
              <Square className="h-5 w-5 md:h-4 md:w-4" />
            </button>
          ) : (
            <button
              onClick={runCode}
              className="p-2 md:p-1.5 rounded hover:bg-[var(--success)]/20 text-[var(--success)] transition-colors"
              title="Run"
            >
              <Play className="h-5 w-5 md:h-4 md:w-4" />
            </button>
          )}

          {/* Refresh - hidden on mobile */}
          <button
            onClick={runCode}
            className="hidden md:block p-1.5 rounded hover:bg-[var(--accent)] transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4 text-[var(--muted)]" />
          </button>

          {/* Copy - hidden on mobile */}
          <button
            onClick={copyCode}
            className="hidden md:block p-1.5 rounded hover:bg-[var(--accent)] transition-colors"
            title="Copy code"
          >
            {copied ? (
              <Check className="h-4 w-4 text-[var(--success)]" />
            ) : (
              <Copy className="h-4 w-4 text-[var(--muted)]" />
            )}
          </button>

          {/* Download - hidden on mobile */}
          <button
            onClick={downloadCode}
            className="hidden md:block p-1.5 rounded hover:bg-[var(--accent)] transition-colors"
            title="Download"
          >
            <Download className="h-4 w-4 text-[var(--muted)]" />
          </button>

          {/* Fullscreen - ALWAYS visible, larger on mobile */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setIsFullscreen(!isFullscreen);
            }}
            className="p-2 md:p-1.5 rounded bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors ml-1"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 className="h-5 w-5 md:h-4 md:w-4" />
            ) : (
              <Maximize2 className="h-5 w-5 md:h-4 md:w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--error)]/10 text-[var(--error)] text-xs flex-shrink-0">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {/* Preview */}
      <div className={`bg-white overflow-auto ${isFullscreen ? 'flex-1 min-h-0' : 'h-64'}`}>
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-modals allow-same-origin"
          title={title || 'Code Preview'}
        />
      </div>
      </div>
    </>
  );
}
