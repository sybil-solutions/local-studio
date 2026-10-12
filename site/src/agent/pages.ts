import {
	infoPages,
	type InfoInline,
	type InfoPageModel,
} from "../content/info-pages.ts";
import { site } from "../domain/site.ts";

const navigation = `<nav aria-label="Primary"><a href="/">Local Studio</a><a href="/developers">Developers</a><a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a></nav>`;

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function renderInline(content: readonly InfoInline[]): string {
	return content
		.map((part) => {
			switch (part.kind) {
				case "text":
					return escapeHtml(part.text);
				case "code":
					return `<code>${escapeHtml(part.code)}</code>`;
				case "link":
					return `<a href="${escapeHtml(part.href)}">${escapeHtml(part.label)}</a>`;
			}
		})
		.join("");
}

function renderBlocks(model: InfoPageModel): string {
	return model.blocks
		.map((block) => {
			if (block.kind === "heading") return `<h2>${escapeHtml(block.text)}</h2>`;
			if (block.kind === "code") return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
			return `<p>${renderInline(block.content)}</p>`;
		})
		.join("\n");
}

function page(
	title: string,
	description: string,
	path: string,
	content: string,
): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${site.origin}${path}"><title>${escapeHtml(title)} - Local Studio by Sybil Solutions</title></head><body>${navigation}<main><h1>${escapeHtml(title)}</h1>${content}</main><footer>Local Studio by <a href="${site.company.url}">Sybil Solutions</a> · <a href="/llms.txt">Agent reference</a> · <a href="/sitemap.xml">Sitemap</a></footer></body></html>
`;
}

function infoPage(model: InfoPageModel): string {
	return page(model.title, model.description, model.path, renderBlocks(model));
}

export const developerHtml = infoPage(infoPages["/developers"]);
export const aboutHtml = infoPage(infoPages["/about"]);
export const contactHtml = infoPage(infoPages["/contact"]);
export const privacyHtml = infoPage(infoPages["/privacy"]);

export const notFoundHtml = page(
	"Page not found",
	"The requested Local Studio page does not exist. Use the recovery links to continue.",
	"/404.html",
	'<p>The requested resource does not exist. Agents and people can recover through the <a href="/sitemap.xml">XML sitemap</a>, <a href="/sitemap.md">markdown sitemap</a>, <a href="/llms.txt">agent reference</a>, <a href="/developers">developer portal</a>, or <a href="/docs">documentation index</a>.</p>',
);

export const notFoundMarkdown = `# 404: Page not found

The requested Local Studio resource does not exist.

- [Sitemap](/sitemap.xml)
- [Agent reference](/llms.txt)
- [Developer portal](/developers)
- [Documentation](/docs)
`;
