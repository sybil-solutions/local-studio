export type DiffPreviewLineKind = "addition" | "context" | "deletion" | "hunk" | "meta";

export type DiffPreviewLine = {
  content: string;
  kind: DiffPreviewLineKind;
  marker: string;
};

export type DiffPreviewModel = {
  additions: number;
  deletions: number;
  lines: DiffPreviewLine[];
};

function hunkLabel(line: string): string {
  const synthetic = line.match(/^@@\s*edit(?:\s+(\d+))?\s*@@$/i);
  if (!synthetic) return line;
  return synthetic[1] ? `Edit ${synthetic[1]}` : "Edit";
}

function parseLine(line: string): DiffPreviewLine {
  if (line.startsWith("diff --git") || line.startsWith("index ")) {
    return { content: line, kind: "meta", marker: "" };
  }
  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    return { content: line.slice(4), kind: "meta", marker: line.slice(0, 3) };
  }
  if (line.startsWith("@@")) {
    return { content: hunkLabel(line), kind: "hunk", marker: "" };
  }
  if (line.startsWith("+")) {
    return { content: line.slice(1), kind: "addition", marker: "+" };
  }
  if (line.startsWith("-")) {
    return { content: line.slice(1), kind: "deletion", marker: "−" };
  }
  if (line.startsWith(" ")) {
    return { content: line.slice(1), kind: "context", marker: "" };
  }
  return { content: line, kind: "context", marker: "" };
}

export function parseDiffPreview(diffText: string): DiffPreviewModel {
  const lines = diffText.replace(/\r\n?/g, "\n").split("\n").map(parseLine);
  return {
    additions: lines.filter((line) => line.kind === "addition").length,
    deletions: lines.filter((line) => line.kind === "deletion").length,
    lines,
  };
}
