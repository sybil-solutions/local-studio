import { site } from "../domain/site.ts";

const AI_BOTS = [
	"GPTBot",
	"OAI-SearchBot",
	"ChatGPT-User",
	"Claude-Web",
	"ClaudeBot",
	"Claude-SearchBot",
	"Claude-User",
	"anthropic-ai",
	"Google-Extended",
	"Google-CloudVertexBot",
	"Google-Agent",
	"Amazonbot",
	"Applebot-Extended",
	"Bytespider",
	"CCBot",
	"PerplexityBot",
	"Perplexity-User",
	"Applebot",
	"FacebookBot",
	"Meta-ExternalAgent",
	"meta-externalagent",
] as const;

export function robotsTxt(): string {
	const SITE_ORIGIN = site.origin;
	const blocks = [
		`# Site: ${site.origin}/`,
		`# Company: ${site.company.name} - ${site.company.url}`,
		`# Products: ${site.products.localStudio.name}, ${site.products.codexShim.name}`,
		`# LLM reference: ${site.origin}/llms.txt`,
		`# Machine index: ${site.origin}/machine`,
		"#",
		"# As a condition of accessing this website, you agree to abide by the",
		"# following content signals:",
		"#",
		"# (a) If a content-signal = yes, you may collect content for the",
		"#     corresponding use.",
		"# (b) If a content-signal = no, you may not collect content for the",
		"#     corresponding use.",
		"# (c) If the website operator does not include a content signal for a",
		"#     corresponding use, the website operator neither grants nor restricts",
		"#     permission via content signal with respect to the corresponding use.",
		"#",
		"# search: building a search index and providing search results.",
		"#         Search does not include providing AI-generated search summaries.",
		"# ai-input: inputting content into one or more AI models (RAG, grounding).",
		"# ai-train: training or fine-tuning AI models.",
		"",
		"User-agent: *",
		"Content-Signal: search=yes, ai-input=yes, ai-train=yes",
		"Allow: /",
		"",
	];
	for (const bot of AI_BOTS) {
		blocks.push(`User-agent: ${bot}`, "Allow: /", "");
	}
	blocks.push(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`, "");
	return blocks.join("\n");
}
