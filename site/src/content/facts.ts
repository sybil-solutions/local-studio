import { site } from "../domain/site.ts";

const upstream = site.upstream;

export const upstreamCredit = `${site.products.localStudio.name} 3.0 is built on ${upstream.name} by ${upstream.authors}, used under the ${upstream.license} License.`;

export const agentNames = ["Codex", "Claude Code", "Cursor", "Grok", "OpenCode", "Antigravity", "Pi", "Oh My Pi"] as const;

export const controllerRoutes = [
	["GET /api/health", "identity and version, no key needed"],
	["GET /v1/models", "every live model across the fleet, plus auto"],
	["POST /v1/chat/completions, /v1/completions", "OpenAI-compatible gateway, streams pass through"],
	["POST /v1/messages", "Anthropic Messages gateway"],
	["POST /v1/responses", "OpenAI Responses gateway"],
	["GET /api/snapshot, /api/node", "machines, GPUs, live models and usage"],
	["GET /api/recipes, POST /api/recipes/<id>/run", "launch pinned registry recipes on free NVIDIA GPUs"],
	["GET /api/tailnet, POST /api/tailnet/deploy", "scan the tailnet and install a controller over ssh"],
	["GET /api/registry", "registry models matched to this machine's hardware"],
] as const;
