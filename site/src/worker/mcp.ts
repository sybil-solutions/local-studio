import { apiProducts, apiStatus, jsonMethodNotAllowed } from "../agent/openapi.ts";

type RpcRequest = {
	readonly jsonrpc?: string;
	readonly id?: number | string | null;
	readonly method?: string;
	readonly params?: { readonly name?: string };
};

const tools = [
	{
		name: "list_products",
		description: "List Local Studio and Codex Shim with canonical URLs and source repositories.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
	},
	{
		name: "get_service_status",
		description: "Check the Local Studio public product metadata API status and version.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
	},
];

function rpc<Body>(id: RpcRequest["id"], body: Body, status = 200): Response {
	return Response.json({ jsonrpc: "2.0", id: id ?? null, ...body }, { status, headers: { "cache-control": "no-store" } });
}

function call(message: RpcRequest): Response {
	switch (message.method) {
		case "initialize":
			return rpc(message.id, {
				result: {
					protocolVersion: "2025-06-18",
					capabilities: { tools: { listChanged: false } },
					serverInfo: { name: "local-studio-public", title: "Local Studio Public MCP", version: "1.0.0" },
					instructions: "Use these read-only tools to discover Local Studio products. No API key is required.",
				},
			});
		case "tools/list":
			return rpc(message.id, { result: { tools } });
		case "tools/call": {
			const name = message.params?.name;
			const data = name === "list_products" ? apiProducts : name === "get_service_status" ? apiStatus : null;
			if (!data) return rpc(message.id, { error: { code: -32602, message: `Unknown tool: ${String(name)}` } });
			return rpc(message.id, {
				result: { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: false },
			});
		}
		default:
			return rpc(message.id, { error: { code: -32601, message: `Method not found: ${String(message.method)}` } });
	}
}

export async function mcpResponse(request: Request): Promise<Response> {
	if (request.method !== "POST") {
		return Response.json(jsonMethodNotAllowed, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
	}
	const message: RpcRequest | null = await request.json().catch(() => null);
	if (message?.jsonrpc !== "2.0" || !message.method) {
		return rpc(message?.id, { error: { code: -32600, message: "Invalid JSON-RPC 2.0 request." } }, 400);
	}
	if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
	return call(message);
}
