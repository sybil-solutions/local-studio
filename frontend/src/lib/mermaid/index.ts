// CRITICAL
import type mermaidType from "mermaid";

let mermaidInstance: typeof mermaidType | null = null;
let mermaidInitialized = false;

const MERMAID_DIAGRAM_PATTERN =
  /^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/;

export function looksLikeMermaidDiagram(code: string): boolean {
  return MERMAID_DIAGRAM_PATTERN.test(code.trim());
}

export function sanitizeMermaidCode(code: string): string {
  let result = code.replace(/<br\s*\/>/gi, "<br>");
  const lines = result.split("\n");

  result = lines
    .map((line) => {
      if (/^\s*(graph|flowchart|sequenceDiagram|subgraph|end)\b/i.test(line)) {
        return line;
      }

      line = line.replace(/(\w+)\[([^\]]*)\]/g, (match, nodeId, content) => {
        if (/\([^)]*\)/.test(content) && !content.startsWith('"')) {
          const escaped = content.replace(/"/g, "'");
          return `${nodeId}["${escaped}"]`;
        }
        return match;
      });

      line = line.replace(/(\w+)\(([^)]*\([^)]*\)[^)]*)\)/g, (_match, nodeId, content) => {
        const fixed = content.replace(/\(([^)]*)\)/g, "[$1]");
        return `${nodeId}(${fixed})`;
      });

      return line;
    })
    .join("\n");

  return result.trim();
}

export async function getMermaid() {
  if (!mermaidInstance) {
    const mod = await import("mermaid");
    mermaidInstance = mod.default;
  }

  if (!mermaidInitialized && mermaidInstance) {
    mermaidInstance.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      fontFamily: "inherit",
      logLevel: "fatal",
    });
    mermaidInitialized = true;
  }

  return mermaidInstance;
}
