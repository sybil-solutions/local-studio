import { createHash } from "node:crypto";
import type { McpToolInfo } from "./mcp-client";

function canonicalUnknown(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalUnknown).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .flatMap((key) => {
        const property = Reflect.get(value, key);
        return property === undefined
          ? []
          : [`${JSON.stringify(key)}:${canonicalUnknown(property)}`];
      })
      .join(",")}}`;
  }
  throw new Error("Connector inventory contains unsupported JSON");
}

function canonicalTool(tool: McpToolInfo): string {
  return canonicalUnknown({
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  });
}

export function connectorInventoryDigest(tools: readonly McpToolInfo[]): string {
  const canonical = tools.map(canonicalTool).sort().join(",");
  return `sha256:${createHash("sha256")
    .update(`local-studio-connector-inventory-v1:[${canonical}]`)
    .digest("hex")}`;
}
