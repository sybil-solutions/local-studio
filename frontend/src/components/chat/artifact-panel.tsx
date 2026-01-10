'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Code,
  Eye,
  EyeOff,
  FileCode,
  Palette,
  Maximize2,
  Minimize2,
  X,
  Download,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  Move,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Play,
  Square,
  RefreshCw,
  ExternalLink,
  Layers,
} from 'lucide-react';
import type { Artifact } from '@/lib/types';

// ============================================================================
// ARTIFACT VIEWER - Full-featured viewer with pan/zoom/interact
// ============================================================================

interface ArtifactViewerProps {
  artifact: Artifact;
  isActive?: boolean;
  onClose?: () => void;
}

// SVG template - wraps SVG in proper HTML document for iframe rendering
const SVG_TEMPLATE = (svgCode: string, scale: number = 1) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #1a1918;
    }
    .container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
    }
    .svg-wrapper {
      transform: scale(${scale});
      transform-origin: center center;
      transition: transform 0.2s ease;
    }
    svg {
      display: block;
      max-width: none;
      max-height: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="svg-wrapper">
      ${svgCode}
    </div>
  </div>
</body>
</html>
`;

// React/HTML template with full viewport
const REACT_TEMPLATE = (code: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #root {
      width: 100%;
      height: 100%;
      background: white;
      overflow: auto;
    }
    .error {
      color: #b91c1c;
      font-family: ui-monospace, monospace;
      white-space: pre-wrap;
      padding: 16px;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="error" class="error" style="display:none;"></div>
  <script type="text/babel" data-presets="react,typescript">
    (() => {
      const send = (type, message) => {
        try { window.parent?.postMessage({ type, message }, '*'); } catch {}
      };
      const showError = (message) => {
        const el = document.getElementById('error');
        if (el) { el.style.display = 'block'; el.textContent = message; }
      };
      window.addEventListener('error', (event) => {
        const msg = event?.error?.stack || event?.message || 'Unknown error';
        send('error', msg);
        showError(msg);
      });
      try {
        window.__DEFAULT_EXPORT__ = undefined;
        const { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } = React;

        // Strip imports/exports for iframe execution
        ${code
          .replace(/^\s*import\s+.*?;?\s*$/gm, '')
          .replace(/^\s*export\s+\{[^}]+\}\s*;?\s*$/gm, '')
          .replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, '$1 ')
          .replace(/\bexport\s+default\s+/g, 'window.__DEFAULT_EXPORT__ = ')}

        const container = document.getElementById('root');
        const root = ReactDOM.createRoot(container);
        const candidate = (typeof App !== 'undefined' && App) || window.__DEFAULT_EXPORT__ || null;
        if (!candidate) {
          showError('Define an App component or use export default.');
          return;
        }
        const element = React.isValidElement(candidate) ? candidate : React.createElement(candidate);
        root.render(element);
      } catch (e) {
        const msg = e?.stack || e?.message || 'Failed to render';
        send('error', msg);
        showError(msg);
      }
    })();
  </script>
</body>
</html>
`;

// JavaScript template
const JS_TEMPLATE = (code: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; padding: 16px; background: white; min-height: 100vh; }
    #output { white-space: pre-wrap; font-family: monospace; }
  </style>
</head>
<body>
  <div id="output"></div>
  <script>
    const output = document.getElementById('output');
    const send = (type, message) => {
      try { window.parent?.postMessage({ type, message }, '*'); } catch {}
    };
    const log = (...args) => {
      const line = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ') + '\\n';
      output.textContent += line;
      send('output', line);
    };
    console.log = log;
    console.info = log;
    console.warn = log;
    console.error = (...args) => { log(...args); send('error', args.map(String).join(' ')); };
    window.addEventListener('error', (e) => send('error', e?.error?.stack || e?.message || 'Error'));
    try { ${code} } catch (e) { output.textContent = 'Error: ' + e.message; send('error', e?.stack || String(e)); }
  </script>
</body>
</html>
`;

// HTML passthrough (already complete)
const HTML_TEMPLATE = (code: string) => {
  // If it's a full document, use as-is, otherwise wrap
  if (code.trim().toLowerCase().startsWith('<!doctype') || code.trim().toLowerCase().startsWith('<html')) {
    return code;
  }
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: white; min-height: 100vh; }
  </style>
</head>
<body>
  ${code}
</body>
</html>
`;
};

export function ArtifactViewer({ artifact, isActive = true, onClose }: ArtifactViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  // Generate iframe srcDoc based on artifact type
  const getSrcDoc = useCallback(() => {
    switch (artifact.type) {
      case 'svg': {
        const svgMarkup = artifact.code.includes('<svg')
          ? artifact.code
          : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${artifact.code}</svg>`;
        return SVG_TEMPLATE(svgMarkup, scale);
      }
      case 'react':
        return REACT_TEMPLATE(artifact.code);
      case 'javascript':
        return JS_TEMPLATE(artifact.code);
      case 'html':
        return HTML_TEMPLATE(artifact.code);
      default:
        return HTML_TEMPLATE(`<pre style="padding:16px;font-family:monospace;">${artifact.code}</pre>`);
    }
  }, [artifact, scale]);

  // Run/refresh the artifact
  const runArtifact = useCallback(() => {
    setIsRunning(true);
    setError(null);
    if (iframeRef.current) {
      iframeRef.current.srcdoc = getSrcDoc();
    }
  }, [getSrcDoc]);

  const stopArtifact = useCallback(() => {
    setIsRunning(false);
    if (iframeRef.current) {
      iframeRef.current.srcdoc = '';
    }
  }, []);

  // Auto-run on mount and when artifact changes
  useEffect(() => {
    if (isActive) {
      runArtifact();
    }
  }, [isActive, artifact.id, runArtifact]);

  // Listen for iframe errors
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'error') {
        setError(event.data.message);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Zoom controls
  const zoomIn = () => setScale(s => Math.min(s + 0.25, 3));
  const zoomOut = () => setScale(s => Math.max(s - 0.25, 0.25));
  const resetView = () => { setScale(1); setPosition({ x: 0, y: 0 }); };

  // Drag/pan handling
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, posX: position.x, posY: position.y };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPosition({ x: dragStartRef.current.posX + dx, y: dragStartRef.current.posY + dy });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale(s => Math.max(0.25, Math.min(3, s + delta)));
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(artifact.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const ext = artifact.type === 'html' ? '.html' :
                artifact.type === 'react' || artifact.type === 'javascript' ? '.jsx' :
                artifact.type === 'svg' ? '.svg' : '.txt';
    const filename = (artifact.title || `artifact-${artifact.id}`).replace(/[^a-z0-9]/gi, '-').toLowerCase() + ext;
    const blob = new Blob([artifact.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenExternal = () => {
    const blob = new Blob([getSrcDoc()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const icon = artifact.type === 'svg' ? <Palette className="h-3.5 w-3.5" /> :
               artifact.type === 'html' ? <FileCode className="h-3.5 w-3.5" /> :
               <Code className="h-3.5 w-3.5" />;

  // Main viewer content
  const ViewerContent = ({ inModal = false, onClose: viewerOnClose }: { inModal?: boolean; onClose?: () => void }) => (
    <div className={`flex flex-col ${inModal ? 'h-full' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--accent)] border-b border-[var(--border)] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="text-xs font-medium truncate">{artifact.title || artifact.type.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-0.5">
          {/* Run/Stop */}
          {isRunning ? (
            <button onClick={stopArtifact} className="p-1.5 rounded hover:bg-[var(--background)] text-[var(--error)]" title="Stop">
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button onClick={runArtifact} className="p-1.5 rounded hover:bg-[var(--background)] text-[var(--success)]" title="Run">
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={runArtifact} className="p-1.5 rounded hover:bg-[var(--background)]" title="Refresh">
            <RefreshCw className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
          <button onClick={() => setShowCode(!showCode)} className="p-1.5 rounded hover:bg-[var(--background)]" title={showCode ? 'Hide code' : 'Show code'}>
            {showCode ? <EyeOff className="h-3.5 w-3.5 text-[#9a9590]" /> : <Eye className="h-3.5 w-3.5 text-[#9a9590]" />}
          </button>
          <button onClick={handleCopy} className="p-1.5 rounded hover:bg-[var(--background)]" title="Copy">
            {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5 text-[#9a9590]" />}
          </button>
          <button onClick={handleDownload} className="p-1.5 rounded hover:bg-[var(--background)]" title="Download">
            <Download className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
          <button onClick={handleOpenExternal} className="p-1.5 rounded hover:bg-[var(--background)]" title="Open in new tab">
            <ExternalLink className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
          {!inModal && (
            <button onClick={() => setIsFullscreen(true)} className="p-1.5 rounded hover:bg-[var(--background)]" title="Fullscreen">
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          {inModal && viewerOnClose && (
            <button onClick={viewerOnClose} className="p-1.5 rounded hover:bg-[var(--background)]" title="Close">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Zoom controls bar */}
      {inModal && (
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-[var(--background)] border-b border-[var(--border)] flex-shrink-0">
          <button onClick={zoomOut} className="p-1 rounded hover:bg-[var(--accent)]" title="Zoom out">
            <ZoomOut className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
          <span className="text-xs text-[#9a9590] tabular-nums w-12 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={zoomIn} className="p-1 rounded hover:bg-[var(--accent)]" title="Zoom in">
            <ZoomIn className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
          <div className="w-px h-4 bg-[var(--border)] mx-1" />
          <button onClick={resetView} className="p-1 rounded hover:bg-[var(--accent)]" title="Reset view">
            <RotateCcw className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
          <button className={`p-1 rounded ${isDragging ? 'bg-[var(--accent)]' : 'hover:bg-[var(--accent)]'}`} title="Pan (drag)">
            <Move className="h-3.5 w-3.5 text-[#9a9590]" />
          </button>
        </div>
      )}

      {/* Code view */}
      {showCode && (
        <pre className="p-3 text-xs bg-[#1e1d1c] overflow-auto border-b border-[var(--border)] flex-shrink-0 max-h-40">
          <code className="text-[#e8e4dd]">{artifact.code}</code>
        </pre>
      )}

      {/* Error display */}
      {error && (
        <div className="px-3 py-2 bg-[var(--error)]/10 text-[var(--error)] text-xs border-b border-[var(--border)] flex-shrink-0">
          {error}
        </div>
      )}

      {/* Preview area */}
      <div
        ref={containerRef}
        className={`relative overflow-hidden bg-white ${inModal ? 'flex-1 min-h-0' : 'h-[400px]'}`}
        style={inModal && scale !== 1 ? { cursor: isDragging ? 'grabbing' : 'grab' } : undefined}
        onMouseDown={inModal ? handleMouseDown : undefined}
        onWheel={inModal ? handleWheel : undefined}
      >
        <div
          className="w-full h-full"
          style={inModal ? {
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.15s ease',
          } : undefined}
        >
          <iframe
            ref={iframeRef}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups"
            title={artifact.title || 'Artifact Preview'}
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Inline viewer */}
      <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--card)]">
        <ViewerContent />
      </div>

      {/* Fullscreen modal */}
      {isFullscreen && (
        <>
          <div className="fixed inset-0 z-[100] bg-black/80" onClick={() => setIsFullscreen(false)} />
          <div className="fixed inset-3 md:inset-6 z-[101] bg-[var(--card)] rounded-xl border border-[var(--border)] overflow-hidden flex flex-col">
            <ViewerContent inModal onClose={() => setIsFullscreen(false)} />
          </div>
        </>
      )}
    </>
  );
}

// ============================================================================
// ARTIFACT PANEL - Right sidebar panel showing all artifacts
// ============================================================================

interface ArtifactPanelProps {
  artifacts: Artifact[];
  onClose: () => void;
  isOpen: boolean;
}

export function ArtifactPanel({ artifacts, onClose, isOpen }: ArtifactPanelProps) {
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  // Auto-select latest artifact when artifacts change
  useEffect(() => {
    if (artifacts.length > 0) {
      // Select the most recent artifact
      setSelectedArtifactId(artifacts[artifacts.length - 1].id);
    }
  }, [artifacts.length]);

  const selectedArtifact = artifacts.find(a => a.id === selectedArtifactId);

  const getIcon = (type: Artifact['type']) => {
    switch (type) {
      case 'svg': return <Palette className="h-3.5 w-3.5" />;
      case 'html': return <FileCode className="h-3.5 w-3.5" />;
      default: return <Code className="h-3.5 w-3.5" />;
    }
  };

  if (!isOpen || artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Layers className="h-8 w-8 text-[#9a9590]/50 mb-2" />
        <p className="text-xs text-[#9a9590]">No artifacts yet</p>
        <p className="text-[10px] text-[#9a9590]/70 mt-1">
          Artifacts appear when the model generates code previews
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Artifact selector dropdown */}
      <div className="px-3 py-2 border-b border-[var(--border)] flex-shrink-0">
        <select
          value={selectedArtifactId || ''}
          onChange={(e) => setSelectedArtifactId(e.target.value)}
          className="w-full text-xs bg-[var(--accent)] border border-[var(--border)] rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--link)]"
        >
          {artifacts.map((artifact, index) => (
            <option key={artifact.id} value={artifact.id}>
              {artifact.title || `${artifact.type.toUpperCase()} #${index + 1}`}
            </option>
          ))}
        </select>
      </div>

      {/* Artifact list (horizontal scroll for multiple) */}
      {artifacts.length > 1 && (
        <div className="flex gap-1 px-3 py-2 border-b border-[var(--border)] overflow-x-auto flex-shrink-0">
          {artifacts.map((artifact, index) => (
            <button
              key={artifact.id}
              onClick={() => setSelectedArtifactId(artifact.id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] whitespace-nowrap transition-colors flex-shrink-0 ${
                artifact.id === selectedArtifactId
                  ? 'bg-[var(--link)]/20 text-[var(--link)]'
                  : 'bg-[var(--accent)] text-[#9a9590] hover:text-[var(--foreground)]'
              }`}
            >
              {getIcon(artifact.type)}
              <span>{artifact.title?.slice(0, 15) || `#${index + 1}`}</span>
            </button>
          ))}
        </div>
      )}

      {/* Selected artifact viewer */}
      <div className="flex-1 overflow-auto p-2 min-h-0">
        {selectedArtifact && (
          <ArtifactViewer artifact={selectedArtifact} isActive />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MINI ARTIFACT CARD - Compact preview for chat messages
// ============================================================================

interface MiniArtifactCardProps {
  artifact: Artifact;
  onClick?: () => void;
}

export function MiniArtifactCard({ artifact, onClick }: MiniArtifactCardProps) {
  const icon = artifact.type === 'svg' ? <Palette className="h-4 w-4" /> :
               artifact.type === 'html' ? <FileCode className="h-4 w-4" /> :
               <Code className="h-4 w-4" />;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)] transition-colors text-left w-full group"
    >
      <div className="flex-shrink-0 w-10 h-10 rounded bg-[var(--accent)] flex items-center justify-center text-[#9a9590] group-hover:text-[var(--foreground)]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {artifact.title || `${artifact.type.toUpperCase()} Artifact`}
        </div>
        <div className="text-xs text-[#9a9590]">
          Click to view • {artifact.code.split('\n').length} lines
        </div>
      </div>
      <ExternalLink className="h-4 w-4 text-[#9a9590] opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

export default ArtifactViewer;
