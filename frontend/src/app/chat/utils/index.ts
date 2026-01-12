'use client';

// Types
export interface StreamEvent {
  type: 'text' | 'tool_calls' | 'done' | 'error';
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  error?: string;
}

// Constants
const BOX_TAGS_PATTERN = /<\|(?:begin|end)_of_box\|>/g;

// Strip thinking tags for model context (keeps artifact code blocks)
export const stripThinkingForModelContext = (text: string): string => {
  if (!text) return text;
  let cleaned = text.replace(BOX_TAGS_PATTERN, '');
  const preservedBlocks: string[] = [];
  cleaned = cleaned.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, (block) => {
    const fenceRegex = /```([a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = fenceRegex.exec(block)) !== null) {
      const lang = (m[1] || '').toLowerCase();
      const isRenderable = ['html', 'svg', 'javascript', 'js', 'react', 'jsx', 'tsx'].includes(lang) || lang.startsWith('artifact-');
      if (isRenderable) preservedBlocks.push(`\n\n\`\`\`${lang}\n${m[2].trim()}\n\`\`\``);
    }
    return '';
  });
  cleaned = cleaned.replace(/<\/?think(?:ing)?>/gi, '');
  return (cleaned.trim() + preservedBlocks.join('')).trim();
};

// Strip thinking tags but keep text inside
export const stripThinkTagsKeepText = (text: string): string => {
  return text?.replace(/<\/?think(?:ing)?>/gi, '') || '';
};

// Try to parse nested JSON from string
export function tryParseNestedJsonString(raw: string): Record<string, unknown> | null {
  try {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}
  return null;
}

// Parse Server-Sent Events from a stream
export async function* parseSSEEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data) {
          try {
            yield JSON.parse(data) as StreamEvent;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  }
}

// Download text as file
export function downloadTextFile(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
