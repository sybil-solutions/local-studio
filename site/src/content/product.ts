import { assets } from "../domain/asset.ts";
type Inline =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "term"; readonly term: string };
export type Prose = readonly Inline[];

const text = (value: string): Inline => ({ kind: "text", text: value });
const term = (value: string): Inline => ({ kind: "term", term: value });

export const productFeatures = [
	{
		slug: "agents",
		storyTitle: "Agents",
		storyDescription: [
			text("Codex, Claude Code, Cursor, Grok, OpenCode and Antigravity, plus "),
			term("Pi"),
			text(" and "),
			term("Oh My Pi"),
			text(", on your own models."),
		],
		productTitle: "Every Agent, Your Models",
		productText: [
			text("Every T3 Code agent works out of the box: Codex, Claude Code, Cursor, Grok, OpenCode and Antigravity. "),
			term("Pi"),
			text(" and "),
			term("Oh My Pi"),
			text(" are first-class providers with streaming, tool calls, steering, rollback and token usage, running on the models you configure."),
		],
		image: assets.shotAgents,
		alt: "Local Studio model picker listing coding agents next to local models.",
	},
	{
		slug: "serve",
		storyTitle: "Serve",
		storyDescription: [
			term("vLLM"),
			text(", "),
			term("SGLang"),
			text(", "),
			term("llama.cpp"),
			text(", LM Studio and any /v1/models server behind one gateway."),
		],
		productTitle: "One Gateway for Every Server",
		productText: [
			text("The bundled controller finds the inference servers on each machine and serves them through Chat Completions, Completions, Anthropic Messages and Responses. The model "),
			term("auto"),
			text(" picks the busiest live model. Pinned local-ai-registry recipes launch on free NVIDIA GPUs without evicting what is running."),
		],
		image: assets.shotServe,
		alt: "Local Studio thread answered by a local model through the controller gateway.",
	},
	{
		slug: "fleet",
		storyTitle: "Fleet",
		storyDescription: [
			text("Settings → Local finds the machines on your tailnet. Connect them, or install a controller in one click."),
		],
		productTitle: "Your Whole Fleet over Tailscale",
		productText: [
			text("Connect links a machine that already runs a controller. Install sets one up over ssh as a systemd or launchd service, bound to its Tailscale address and sharing your fleet key. A model loaded on any machine is usable from every machine and every agent."),
		],
		image: assets.shotFleet,
		alt: "Local Studio Settings, Local page with a machine, its memory, live models and usage.",
	},
	{
		slug: "registry",
		storyTitle: "Registry",
		storyDescription: [
			text("Hardware-matched recommendations. Browse 700+ models, download weights, share what works."),
		],
		productTitle: "Recipes Matched to Your Hardware",
		productText: [
			text("Your GPUs, or your Apple chip and its unified memory, are matched against local-ai-registry hardware records. Turn on All hardware to browse every model, inspect its records, copy the launch command or download pinned weights. Share turns a running server into registry records and opens a pull request with your own "),
			term("gh"),
			text(" login."),
		],
		image: assets.shotRegistry,
		alt: "Local Studio registry recommendations matched to the machine's hardware.",
	},
	{
		slug: "fast",
		storyTitle: "Fast",
		storyDescription: [
			text("Long threads open in about 90 ms. Follow-ups stream with no dropped frames."),
		],
		productTitle: "Fast in Long Threads",
		productText: [
			text("On a 209-message, 282k-token thread, the production build opens the thread with about 90 ms of main-thread work, and follow-up turns stream without dropped frames."),
		],
		image: assets.shotThread,
		alt: "Local Studio thread with an agent's answer, code and changed files.",
	},
] as const;

export function renderInlineMarkdown(prose: Prose): string {
	return prose.map((part) => (part.kind === "text" ? part.text : part.term)).join("");
}
