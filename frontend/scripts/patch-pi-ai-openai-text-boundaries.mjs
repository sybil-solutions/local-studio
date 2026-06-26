import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetFiles = [
  path.join(frontendRoot, "node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js"),
  path.join(
    frontendRoot,
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js",
  ),
];

const helperMarker = "function localStudioJoinTextParts";
const helper =
  [
    "function localStudioTextPartBoundary(left, right) {",
    '    if (!left || !right || /\\s$/.test(left) || /^\\s/.test(right))',
    '        return "";',
    '    if (/^[-*+]$/.test(right) && /[.:;!?]["\')\\]]?$/.test(left))',
    '        return "\\n";',
    '    if (/^(?:[-*+](?:\\s+|[A-Z0-9"`*_])|\\d+[.)]\\s+)/.test(right))',
    '        return "\\n";',
    '    if (/[.!?]["\')\\]\\u201d]?$/.test(left) && /^[A-Z0-9"\\u201c\'`*_]/.test(right))',
    '        return "\\n\\n";',
    '    if (/[:;]["\')\\]\\u201d]?$/.test(left) && /^(?:[-*+]|\\d+[.)]|[A-Z0-9"\\u201c\'`*_])/.test(right))',
    '        return "\\n";',
    '    return "";',
    "}",
    "function localStudioLineEndsWithBareListMarker(text) {",
    "    return /(?:^|\\n)[ \\t]*[-*+]$/.test(text);",
    "}",
    "function localStudioJoinTextPart(left, right) {",
    "    const boundary = localStudioTextPartBoundary(left, right);",
    '    const nextRight = boundary.includes("\\n") && /^[-*+](?=\\S)/.test(right)',
    '        ? `${right.slice(0, 1)} ${right.slice(1)}`',
    "        : right;",
    '    const prefix = localStudioLineEndsWithBareListMarker(left) && /^\\S/.test(nextRight) ? " " : "";',
    "    return left + boundary + prefix + nextRight;",
    "}",
    "function localStudioJoinTextParts(parts) {",
    "    return parts",
    "        .map((part) => part.text)",
    '        .reduce((text, partText) => localStudioJoinTextPart(text, partText), "");',
    "}",
  ].join("\n") + "\n";

const injectionPoint = `function isTextContentBlock(block) {
    return block.type === "text";
}
`;
const helperStartMarker = "function localStudioTextPartBoundary";
const helperEndMarker = "function isThinkingContentBlock";
const originalJoin = `const assistantText = assistantTextParts.map((part) => part.text).join("");`;
const patchedJoin = `const assistantText = localStudioJoinTextParts(assistantTextParts);`;

let found = 0;
let patched = 0;
for (const file of targetFiles) {
  if (!existsSync(file)) continue;
  found += 1;
  let source = readFileSync(file, "utf8");
  let next = source;
  if (!next.includes(helperMarker)) {
    if (!next.includes(injectionPoint)) {
      throw new Error(`Could not find pi-ai text block helper injection point in ${file}`);
    }
    next = next.replace(injectionPoint, `${injectionPoint}${helper}`);
  } else {
    const helperStart = next.indexOf(helperStartMarker);
    const helperEnd = next.indexOf(helperEndMarker, helperStart);
    if (helperStart === -1 || helperEnd === -1) {
      throw new Error(`Could not find existing pi-ai text boundary helper block in ${file}`);
    }
    next = next.slice(0, helperStart) + helper + next.slice(helperEnd);
  }
  if (next.includes(originalJoin)) {
    next = next.replace(originalJoin, patchedJoin);
  } else if (!next.includes(patchedJoin)) {
    throw new Error(`Could not find pi-ai assistant text join in ${file}`);
  }
  if (next !== source) {
    writeFileSync(file, next, "utf8");
    patched += 1;
  }
}

if (found === 0) {
  // Loud but non-fatal: a missing pi-ai layout means agent streaming will
  // misrender assistant text, and silence here hides that until runtime.
  console.warn(
    [
      "WARNING: patch-pi-ai-openai-text-boundaries.mjs found no pi-ai openai-completions.js to patch.",
      "Checked:",
      ...targetFiles.map((file) => `  - ${file}`),
      "The @earendil-works/pi-ai package layout may have changed. Agent streaming may misrender",
      "assistant text (missing paragraph/list boundaries) until this patch script is updated.",
    ].join("\n"),
  );
} else if (patched > 0) {
  console.log(`Patched pi-ai OpenAI assistant text boundaries in ${patched} file(s).`);
}
