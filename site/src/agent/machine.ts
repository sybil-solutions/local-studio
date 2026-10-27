import { productFeatures, renderInlineMarkdown } from "../content/product.ts";
import { release } from "../domain/release.ts";
import { routePaths, routes, type RoutePath } from "../domain/route.ts";
import { site } from "../domain/site.ts";
import { upstreamCredit } from "../content/facts.ts";

const SITE_ORIGIN = site.origin;

function field(name: string, value: string): string {
	return `${name.padEnd(14, ".")} ${value}`;
}

function routeLine(path: RoutePath): string {
	const dots = ".".repeat(Math.max(1, 14 - path.length));
	return `${path} ${dots} ${routes[path].machineLabel} - ${routes[path].summary}`;
}

type MachineSection = readonly [name: string, lines: readonly string[]];

export function machineSections(): readonly MachineSection[] {
	return [
		[
			"COMPANY",
			[
				field("name", site.company.name),
				field("url", site.company.url),
				field("github", site.company.github),
				field("contact", site.company.contact),
			],
		],
		[
			"THIS_SITE",
			[
				field("host", SITE_ORIGIN.replace("https://", "")),
				field("name", site.products.localStudio.name),
				field("source", site.source),
				"HTML routes have markdown twins; use Accept: text/markdown or append .md.",
			],
		],
		[
			"PRODUCTS",
			[
				`${site.products.localStudio.name} - every coding agent on your own models, on every machine you own`,
				`${site.products.codexShim.name} - local Responses API shim for Codex Desktop`,
			],
		],
		[
			"LOCAL_STUDIO",
			[
				upstreamCredit,
				field("platforms", "macOS arm64/x64, Windows x64, Linux x64/arm64"),
				field("current", `${release.major}.x, verified at ${release.api}`),
				field("download", `${SITE_ORIGIN}${release.sitePath}`),
				field("controller", "127.0.0.1:18091, fleet key bearer auth"),
				field("upstream", site.upstream.repository),
				...productFeatures.map(
					(feature) => `${feature.storyTitle}: ${renderInlineMarkdown(feature.storyDescription)}`,
				),
			],
		],
		[
			"ROUTES",
			routePaths.map(routeLine),
		],
		[
			"DISCOVERY",
			[
				"robots.txt ............. /robots.txt",
				"sitemap.xml ............ /sitemap.xml",
				"llms.txt ............... /llms.txt",
				"llms-full.txt .......... /llms-full.txt",
				"agent-card ............. /.well-known/agent-card.json",
				"api-catalog ............ /.well-known/api-catalog",
				"HTML to markdown: append .md or send Accept: text/markdown.",
			],
		],
	];
}

export function machineText(): string {
	const lines = [
		"local studio :: machine-readable index",
		`company: ${site.company.name} - ${site.company.url}`,
		"",
	];
	for (const [name, body] of machineSections()) lines.push(`── ${name}`, ...body, "");
	lines.push(":: end of index ::", "");
	return lines.join("\n");
}
