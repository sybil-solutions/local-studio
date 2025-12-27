'use client';

import { useState, useMemo } from 'react';
import {
  Code,
  Eye,
  EyeOff,
  FileCode,
  Palette,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import { CodeSandbox } from './code-sandbox';
import type { Artifact } from '@/lib/types';

interface ArtifactRendererProps {
  artifact: Artifact;
  onRun?: () => void;
}

export function ArtifactRenderer({ artifact, onRun }: ArtifactRendererProps) {
  const [showPreview, setShowPreview] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const language = useMemo(() => {
    switch (artifact.type) {
      case 'html':
        return 'html' as const;
      case 'react':
        return 'react' as const;
      case 'python':
        return 'javascript' as const; // Python will need backend execution
      case 'javascript':
        return 'javascript' as const;
      default:
        return 'html' as const;
    }
  }, [artifact.type]);

  const icon = useMemo(() => {
    switch (artifact.type) {
      case 'html':
        return <FileCode className="h-3.5 w-3.5" />;
      case 'react':
        return <Code className="h-3.5 w-3.5" />;
      case 'svg':
        return <Palette className="h-3.5 w-3.5" />;
      default:
        return <Code className="h-3.5 w-3.5" />;
    }
  }, [artifact.type]);

  // Handle SVG directly
  if (artifact.type === 'svg') {
    const svgMarkup =
      artifact.code.includes('<svg')
        ? artifact.code
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${artifact.code}</svg>`;
    return (
      <>
        {/* Fullscreen backdrop */}
        {isFullscreen && (
          <div
            className="fixed inset-0 z-[100] bg-black/80"
            onClick={() => setIsFullscreen(false)}
          />
        )}
        <div className={`my-2 rounded-lg border border-[var(--border)] overflow-hidden ${
          isFullscreen ? 'fixed inset-0 z-[101] m-0 rounded-none flex flex-col' : ''
        }`}>
          <div className="flex items-center justify-between px-2 md:px-3 py-2 bg-[var(--accent)] border-b border-[var(--border)] flex-shrink-0">
            <div className="flex items-center gap-2">
              {icon}
              <span className="text-xs font-medium">{artifact.title || 'SVG'}</span>
            </div>
            <div className="flex items-center gap-0.5 md:gap-1">
              <button
                onClick={() => setShowCode(!showCode)}
                className="p-2 md:p-1.5 rounded hover:bg-[var(--background)] transition-colors"
                title={showCode ? 'Hide code' : 'Show code'}
              >
                {showCode ? (
                  <EyeOff className="h-5 w-5 md:h-4 md:w-4 text-[var(--muted)]" />
                ) : (
                  <Eye className="h-5 w-5 md:h-4 md:w-4 text-[var(--muted)]" />
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsFullscreen(!isFullscreen);
                }}
                className="p-2 md:p-1.5 rounded bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors"
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
          {showCode && (
            <pre className="p-3 text-xs bg-[var(--background)] overflow-x-auto border-b border-[var(--border)] flex-shrink-0">
              <code>{artifact.code}</code>
            </pre>
          )}
          <div
            className={`p-4 bg-white overflow-auto ${isFullscreen ? 'flex-1 flex items-center justify-center' : ''}`}
            style={{ maxHeight: isFullscreen ? undefined : '300px' }}
          >
            <div
              className="svg-container"
              style={{ maxWidth: '100%', overflow: 'hidden' }}
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          </div>
        </div>
      </>
    );
  }

  // Handle Mermaid (delegate to parent's mermaid renderer)
  if (artifact.type === 'mermaid') {
    return (
      <div className="my-2">
        <pre className="mermaid">{artifact.code}</pre>
      </div>
    );
  }

  // Handle Python (needs backend execution)
  if (artifact.type === 'python') {
    return (
      <div className="my-2 rounded-lg border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-[var(--accent)] border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Code className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">{artifact.title || 'Python'}</span>
            <span className="text-xs text-[var(--muted)] px-1.5 py-0.5 bg-[var(--background)] rounded">
              python
            </span>
          </div>
        </div>
        <pre className="p-3 text-xs bg-[var(--background)] overflow-x-auto">
          <code>{artifact.code}</code>
        </pre>
        {artifact.output && (
          <div className="p-3 border-t border-[var(--border)] bg-[var(--card)]">
            <p className="text-xs text-[var(--muted)] mb-1">Output:</p>
            <pre className="text-xs whitespace-pre-wrap">{artifact.output}</pre>
          </div>
        )}
        {artifact.error && (
          <div className="p-3 border-t border-[var(--border)] bg-[var(--error)]/10">
            <p className="text-xs text-[var(--error)]">{artifact.error}</p>
          </div>
        )}
      </div>
    );
  }

  // Handle HTML, React, JavaScript with CodeSandbox
  return (
    <div className="my-2">
      <CodeSandbox
        code={artifact.code}
        language={language}
        title={artifact.title}
        autoRun={showPreview}
      />
    </div>
  );
}

// Utility to extract artifacts from message content
export function extractArtifacts(content: string): { text: string; artifacts: Artifact[] } {
  const artifacts: Artifact[] = [];
  let text = content;

  // Pattern 1: <artifact type="html" title="...">...</artifact>
  const artifactTagRegex = /<artifact\s+type="([^"]+)"(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/artifact>/g;
  let match;

  while ((match = artifactTagRegex.exec(content)) !== null) {
    const type = match[1] as Artifact['type'];
    const title = match[2] || '';
    const code = match[3].trim();

    artifacts.push({
      id: `artifact-${artifacts.length}-${Date.now()}`,
      type,
      title,
      code,
    });

    // Remove the artifact from text
    text = text.replace(match[0], `[Artifact: ${title || type}]`);
  }

  // Pattern 2: ```artifact-html ... ``` or ```artifact-react ... ```
  const artifactCodeBlockRegex = /```artifact-(html|react|javascript|python|svg|mermaid)\s*\n([\s\S]*?)```/g;

  while ((match = artifactCodeBlockRegex.exec(content)) !== null) {
    const type = match[1] as Artifact['type'];
    const code = match[2].trim();

    artifacts.push({
      id: `artifact-${artifacts.length}-${Date.now()}`,
      type,
      title: '',
      code,
    });

    text = text.replace(match[0], `[Artifact: ${type}]`);
  }

  // Pattern 3: Regular HTML code blocks (```html) when artifacts mode is enabled
  // This is handled by the parent component by checking if artifactsEnabled

  return { text, artifacts };
}

// Check if a code block should be treated as an artifact
export function isArtifactCodeBlock(language: string): boolean {
  const artifactLanguages = [
    'artifact-html',
    'artifact-react',
    'artifact-python',
    'artifact-svg',
    'artifact-mermaid',
  ];
  return artifactLanguages.includes(language);
}

// Get artifact type from code block language
export function getArtifactType(language: string): Artifact['type'] | null {
  const mapping: Record<string, Artifact['type']> = {
    'artifact-html': 'html',
    'artifact-react': 'react',
    'artifact-javascript': 'javascript',
    'artifact-python': 'python',
    'artifact-svg': 'svg',
    'artifact-mermaid': 'mermaid',
    'html': 'html',
    'react': 'react',
    'jsx': 'react',
    'tsx': 'react',
    'svg': 'svg',
    'javascript': 'javascript',
    'js': 'javascript',
  };
  return mapping[language] || null;
}
