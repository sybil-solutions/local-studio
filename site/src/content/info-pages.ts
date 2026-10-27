import { site } from "../domain/site.ts";

export type InfoInline =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "code"; readonly code: string }
	| { readonly kind: "link"; readonly href: string; readonly label: string };

export type InfoBlock =
	| { readonly kind: "code"; readonly text: string }
	| { readonly kind: "heading"; readonly text: string }
	| { readonly kind: "paragraph"; readonly content: readonly InfoInline[] };

export type InfoPageModel = {
	readonly description: string;
	readonly path: InfoPath;
	readonly title: string;
	readonly blocks: readonly InfoBlock[];
};

export type InfoPath = "/about" | "/contact" | "/developers" | "/privacy";

export const infoPaths = [
	"/developers",
	"/about",
	"/contact",
	"/privacy",
] as const satisfies readonly InfoPath[];

export const infoPages = {
	"/developers": {
		path: "/developers",
		title: "Developers",
		description:
			"Local Studio developer portal: public API, OpenAPI schema, MCP tools, authentication, errors, and quickstart examples.",
		blocks: [
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "Build agent integrations with Local Studio by Sybil Solutions. This portal describes the public, read-only product metadata API hosted on this site and points to the separate controller API that runs on each Local Studio installation. Start with the machine-readable " },
					{ kind: "link", href: "/openapi.json", label: "OpenAPI 3.1 specification" },
					{ kind: "text", text: " or the " },
					{ kind: "link", href: "/.well-known/mcp", label: "MCP Streamable HTTP endpoint" },
					{ kind: "text", text: "." },
				],
			},
			{ kind: "heading", text: "Quickstart and Sandbox" },
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "The public endpoints are a safe production sandbox. They require no account, API key, or write access. Responses are JSON and may be cached. Use them to test discovery, schema ingestion, function calling, health checks, and product lookup without creating user data." },
				],
			},
			{
				kind: "code",
				text: `curl -s ${site.origin}/api/v1/status
curl -s ${site.origin}/api/v1/products
curl -s ${site.origin}/openapi.json`,
			},
			{ kind: "heading", text: "Authentication" },
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "No authentication is required for this site's public metadata API. Local Studio's controller is different: it binds to " },
					{ kind: "code", code: "127.0.0.1:18091" },
					{ kind: "text", text: " by default and every route except " },
					{ kind: "code", code: "/api/health" },
					{ kind: "text", text: " requires the fleet key from " },
					{ kind: "code", code: "~/.local-studio-t3/config.json" },
					{ kind: "text", text: " as a bearer token. Keep fleet keys out of prompts, URLs, source control, and logs. The controller API is listed in " },
					{ kind: "link", href: "/agents.md", label: "agents.md" },
					{ kind: "text", text: "." },
				],
			},
			{ kind: "heading", text: "Errors and Limits" },
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "API errors use JSON with a stable error code, a human-readable message, a resolution hint, and a documentation link. The public metadata surface is intentionally small and read-only. Use normal conditional requests and avoid repeated polling. No webhooks are offered by this marketing site." },
				],
			},
			{ kind: "heading", text: "Agent Protocols" },
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "Function-calling clients should derive tools from " },
					{ kind: "link", href: "/openapi.json", label: "OpenAPI" },
					{ kind: "text", text: ". MCP clients can initialize at " },
					{ kind: "code", code: "/.well-known/mcp" },
					{ kind: "text", text: ", list tools, and call the read-only product catalog tool. Agents should also read " },
					{ kind: "link", href: "/llms.txt", label: "llms.txt" },
					{ kind: "text", text: ", " },
					{ kind: "link", href: "/agents.md", label: "agents.md" },
					{ kind: "text", text: ", and the " },
					{ kind: "link", href: "/.well-known/api-catalog", label: "API catalog" },
					{ kind: "text", text: "." },
				],
			},
		],
	},
	"/about": {
		path: "/about",
		title: "About",
		description:
			"About Local Studio and Sybil Solutions, the team building local-first software for self-hosted AI.",
		blocks: [
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "Local Studio is a desktop app for macOS, Windows and Linux made by " },
					{ kind: "link", href: site.company.url, label: "Sybil Solutions" },
					{ kind: "text", text: ". It runs every major coding agent, including Codex, Claude Code, Cursor, Grok, OpenCode, Antigravity, Pi and Oh My Pi, on models that people serve on their own machines, without turning their work into a cloud account." },
				],
			},
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "Local Studio 3.0 is built on " },
					{ kind: "link", href: site.upstream.repository, label: site.upstream.name },
					{ kind: "text", text: ` by ${site.upstream.authors}, used under the MIT License. Local Studio adds a bundled controller that serves vLLM, SGLang, llama.cpp, LM Studio and any /v1/models server through one OpenAI- and Anthropic-compatible gateway, a machine fleet over Tailscale, and local-ai-registry recipes. Its source is public under the MIT License, and builds are published through GitHub Releases.` },
				],
			},
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "Sybil Solutions also maintains Codex Shim, a local Responses API bridge for bring-your-own-key models. Both products share one goal: useful AI software should keep infrastructure choices, credentials, files, and sessions in the user's hands." },
				],
			},
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "This website is the canonical product and documentation index for Local Studio. Use the " },
					{ kind: "link", href: "/docs", label: "documentation" },
					{ kind: "text", text: " to install the app, the " },
					{ kind: "link", href: "/setup", label: "setup prompt" },
					{ kind: "text", text: " for agent-assisted installation, or the " },
					{ kind: "link", href: "/developers", label: "developer portal" },
					{ kind: "text", text: " for machine-readable integration resources." },
				],
			},
		],
	},
	"/contact": {
		path: "/contact",
		title: "Contact",
		description:
			"Contact Sybil Solutions about Local Studio support, security, partnerships, and developer integrations.",
		blocks: [
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "Contact Sybil Solutions about Local Studio at " },
					{ kind: "link", href: `mailto:${site.company.contact}`, label: site.company.contact },
					{ kind: "text", text: ". Email is the official contact channel for product questions, responsible security reports, partnerships, developer integrations, and corrections to this website. Include “Local Studio” and a short topic in the subject so the request can be routed correctly." },
				],
			},
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "For technical support, include the Local Studio version, operating system, inference runtime, expected result, actual result, and the smallest safe reproduction. Remove API keys, fleet keys, pairing links, private model paths, prompts, and user files before sending logs or screenshots. Public code issues may also be reported in the relevant " },
					{ kind: "link", href: site.products.localStudio.repository, label: "GitHub repository" },
					{ kind: "text", text: "." },
				],
			},
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "For security reports, describe the affected component, impact, prerequisites, and reproducible steps. Do not publish active credentials or personal data. Sybil Solutions does not ask for fleet keys, provider keys, pairing links, or remote shell credentials by email." },
				],
			},
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "Local Studio is an online-first product and Sybil Solutions does not publish a visitor office or telephone support line on this site. The verified organization links are the " },
					{ kind: "link", href: site.company.url, label: "company website" },
					{ kind: "text", text: ", " },
					{ kind: "link", href: site.company.github, label: "GitHub organization" },
					{ kind: "text", text: ", and " },
					{ kind: "link", href: site.company.x, label: "X profile" },
					{ kind: "text", text: ". Agents should use these canonical links for identity checks." },
				],
			},
		],
	},
	"/privacy": {
		path: "/privacy",
		title: "Privacy",
		description:
			"Privacy information for the Local Studio product website and its local-first desktop and mobile software.",
		blocks: [
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "This page explains the privacy boundary of the Local Studio product website. The site is a public documentation and download surface. It does not provide user accounts, accept model prompts, upload local files, sell personal information, or expose a hosted inference service. The public metadata API is read-only and does not require an API key." },
				],
			},
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "Hosting and network providers may process standard request data such as IP address, user agent, requested URL, timestamp, and diagnostic logs to deliver and protect the site. Links to GitHub, Apple, Google, T3 Code, Sybil Solutions, and social profiles lead to third-party services with their own privacy terms. This site does not control those services." },
				],
			},
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "Local Studio itself is local-first. Models, agent credentials, project files, terminal activity, and controller state remain on systems selected by the operator. A controller binds to loopback by default. Operators who link machines or pair phones are responsible for access controls, fleet keys, network policy, retention, and the privacy obligations of their environment." },
				],
			},
			{
				kind: "paragraph",
				content: [
					{ kind: "text", text: "Fleet keys and phone pairing links are credentials and should be treated like passwords. Do not send them through this website or include them in public issue reports. For privacy questions or requests about information sent directly to Sybil Solutions, email " },
					{ kind: "link", href: `mailto:${site.company.contact}`, label: site.company.contact },
					{ kind: "text", text: ` with enough detail to locate the communication. This notice was last updated ${site.lastmod}.` },
				],
			},
		],
	},
} as const satisfies Record<InfoPath, InfoPageModel>;
