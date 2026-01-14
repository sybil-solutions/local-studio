const BOX_TAGS_PATTERN = /<\|(?:begin|end)_of_box\|>/g;
const stripBoxTags = (text: string) => (text ? text.replace(BOX_TAGS_PATTERN, '') : text);

export function stripThinkTagsKeepText(text: string): string {
  return text?.replace(/<\/?think(?:ing)?>/gi, '') || '';
}

export function normalizeAssistantMarkdownForRender(content: string): string {
  if (!content) return '';
  let text = stripBoxTags(content);

  // Fix common "no newline after fence language" issue (e.g., ```html<!DOCTYPE html>)
  text = text.replace(/```(html|svg|jsx|tsx|react|javascript|js)(?=\S)/gi, '```$1\n');

  // Some models output `mermaidgraph` instead of `mermaid`.
  text = text.replace(/```mermaidgraph\b/gi, '```mermaid');
  // And sometimes they omit the `graph` keyword: ```mermaidgraph LR A-->B
  text = text.replace(/```mermaid\s*(?:graph\s+)?(?=[A-Z]{1,3}\b)/gi, '```mermaid\ngraph ');

  // Repair standalone `mermaidgraph` blocks that aren't fenced, and fix ` `` ` closers.
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;

  const isFenceCloser = (line: string) => /^\s*```\s*$/.test(line) || /^\s*``\s*$/.test(line);
  const isFenceOpener = (line: string) => /^\s*```/.test(line);
  const isHeading = (line: string) => /^#{1,6}\s+/.test(line);
  const isTableDivider = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  const isTableRow = (line: string) => {
    const pipeCount = (line.match(/\|/g) || []).length;
    if (pipeCount < 2) return false;
    return !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  };

  let inFence = false;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!inFence && /^mermaidgraph\b/i.test(trimmed)) {
      const rest = trimmed.replace(/^mermaidgraph\b/i, '').trim();
      out.push('```mermaid');
      if (rest) out.push(`graph ${rest}`);
      else out.push('graph TD');
      i++;

      while (i < lines.length) {
        const l = lines[i];
        if (isFenceOpener(l) || isFenceCloser(l)) {
          i++;
          break;
        }
        out.push(l);
        i++;
      }

      out.push('```');
      continue;
    }

    if (/^\s*``\s*$/.test(raw)) {
      out.push('```');
      inFence = !inFence;
      i++;
      continue;
    }

    if (isFenceCloser(raw) && inFence) {
      inFence = false;
      out.push(raw);
      i++;
      continue;
    }

    if (isFenceOpener(raw)) {
      inFence = true;
      out.push(raw);
      i++;
      continue;
    }

    if (!inFence) {
      let normalized = raw;

      if (/^\s*#{1,6}(?=\S)/.test(normalized)) {
        normalized = normalized.replace(/^(\s*#{1,6})(?=\S)/, '$1 ');
      }

      if (/(\S)(#{2,6})(?=[A-Za-z])/.test(normalized)) {
        normalized = normalized.replace(/(\S)(#{2,6})(?=[A-Za-z])/g, '$1\n\n$2 ');
      }

      const normalizedTrimmed = normalized.trim();

      if (normalizedTrimmed && isHeading(normalizedTrimmed)) {
        const prev = out[out.length - 1]?.trim() ?? '';
        if (prev) out.push('');
        out.push(normalizedTrimmed);
        i++;
        continue;
      }

      if (normalizedTrimmed && (isTableRow(normalizedTrimmed) || isTableDivider(normalizedTrimmed))) {
        const prev = out[out.length - 1]?.trim() ?? '';
        if (prev && !(isTableRow(prev) || isTableDivider(prev))) {
          out.push('');
        }
        let tableLine = normalizedTrimmed;
        if (!tableLine.startsWith('|')) tableLine = `| ${tableLine}`;
        if (!tableLine.endsWith('|')) tableLine = `${tableLine} |`;
        out.push(tableLine);
        i++;
        continue;
      }

      out.push(normalized);
      i++;
      continue;
    }

    out.push(raw);
    i++;
  }

  return out.join('\n');
}
