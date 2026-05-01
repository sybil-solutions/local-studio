// CRITICAL
const MERMAID_DIAGRAM_PATTERN =
  /^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/;

const MERMAID_SECTION_KEYWORD_PATTERN =
  /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|subgraph|end)\b/i;
const MERMAID_QUOTED_LABEL_PATTERN = /^(["']).*\1$/;
const DEFAULT_MERMAID_RENDER_ERROR = "Unable to render Mermaid diagram. Check diagram syntax.";
const MERMAID_MAX_ERROR_LENGTH = 140;

export function looksLikeMermaidDiagram(code: string): boolean {
  return MERMAID_DIAGRAM_PATTERN.test(code.trim());
}

function fixBrokenEdgeLineBreaks(code: string): string {
  return code
    .replace(/-\s*\n\s*-\s+/g, "-- ")
    .replace(/-\s*\n\s*->/g, "-->")
    .replace(/<-\s*\n\s*-/g, "<--");
}

function normalizeNodeLabel(nodeId: string, content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return `${nodeId}[]`;
  if (MERMAID_QUOTED_LABEL_PATTERN.test(trimmed)) return `${nodeId}[${trimmed}]`;

  const shouldQuote = /[(){}]/.test(trimmed);
  if (!shouldQuote) return `${nodeId}[${trimmed}]`;

  const escaped = trimmed.replace(/"/g, "'");
  return `${nodeId}["${escaped}"]`;
}

function sanitizeMermaidLine(line: string): string {
  if (MERMAID_SECTION_KEYWORD_PATTERN.test(line)) {
    return line;
  }

  let nextLine = line;

  nextLine = nextLine.replace(/(\w+)\[([^\]]*)\]/g, (_match, nodeId, content) =>
    normalizeNodeLabel(nodeId, content),
  );

  nextLine = nextLine.replace(/(\w+)\(([^)]*\([^)]*\)[^)]*)\)/g, (_match, nodeId, content) => {
    const fixed = content.replace(/\(([^)]*)\)/g, "[$1]");
    return `${nodeId}(${fixed})`;
  });

  nextLine = nextLine.replace(/\|([^|\n]*\{[^|\n]*\}[^|\n]*)\|/g, (_match, content) => {
    const trimmed = content.trim();
    if (!trimmed || MERMAID_QUOTED_LABEL_PATTERN.test(trimmed)) {
      return `|${content}|`;
    }
    const escaped = trimmed.replace(/"/g, "'");
    return `|"${escaped}"|`;
  });

  nextLine = nextLine.replace(/--\s+([^>\n]*\{[^}\n]*\}[^>\n]*)\s+-->/g, (_match, content) => {
    const normalized = content.trim().replace(/\{([^}]*)\}/g, "($1)");
    return `-- ${normalized} -->`;
  });

  return nextLine;
}

export function sanitizeMermaidCode(code: string): string {
  let result = code.replace(/\r\n/g, "\n").replace(/<br\s*\/>/gi, "<br>");
  result = fixBrokenEdgeLineBreaks(result);

  return result
    .split("\n")
    .map((line) => sanitizeMermaidLine(line))
    .join("\n")
    .trim();
}

export function summarizeMermaidError(error: unknown): string {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const normalized = raw.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return DEFAULT_MERMAID_RENDER_ERROR;
  }

  if (/parse error|lexical error|syntax error/i.test(normalized)) {
    const line = normalized.match(/\bline\s+(\d+)\b/i)?.[1];
    return line
      ? `Unable to render Mermaid diagram due to syntax issues near line ${line}.`
      : DEFAULT_MERMAID_RENDER_ERROR;
  }

  if (normalized.length <= MERMAID_MAX_ERROR_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MERMAID_MAX_ERROR_LENGTH - 1)}…`;
}
