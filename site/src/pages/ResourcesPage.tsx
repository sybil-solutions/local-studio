import { baseStyles } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { CtaPair } from "../components/Links";
import { LocalLink } from "../components/LocalLink";
import { DocsLayout } from "../components/DocsLayout";
import { PageCta } from "../components/PageCta";
import { PageIntro } from "../components/PageIntro";
import { PageShell } from "../components/PageShell";
import {
	docsPath,
	downloadPath,
	overviewPath,
	routePaths,
	routes,
	setupPath,
} from "../domain/route";
import { release } from "../domain/release";
import { site } from "../domain/site";
import { agentNames, upstreamCredit } from "../content/facts";
import { styles } from "../styles/pages-styles";

const toc = [
	["Start Here", "start-here"],
	["This Site", "this-site"],
	["Local Studio", "local-studio"],
	["Models and Machines", "runtimes"],
	["T3 Code", "upstream"],
	["Codex Shim", "codex-shim"],
	["For Machines", "for-machines"],
	["Source and Company", "source"],
] as const;

interface OverviewEntry {
	label: string;
	text: ReactNode;
	href?: string;
	external?: boolean;
	plain?: boolean;
	code?: boolean;
}

const starts: readonly OverviewEntry[] = [
	{
		label: "Download",
		text: "Installers for macOS, Windows and Linux, plus controller binaries. Every link verifies the release before it redirects.",
		href: downloadPath,
	},
	{
		label: "Documentation",
		text: "Install the app, connect agents, serve local models, link machines over Tailscale and pair a phone.",
		href: docsPath,
	},
	{
		label: "Setup Prompt",
		text: "One portable prompt. Give it to a coding agent and it installs Local Studio, then proves a model answers through the controller.",
		href: setupPath,
	},
];

const siteRoutes: readonly OverviewEntry[] = routePaths.map((path) => ({
	label: path,
	text: routes[path].summary,
	href: path,
	code: true,
}));

const studioFacts: readonly OverviewEntry[] = [
	{ label: "Current", text: `${release.major}.x, published by GitHub Actions with a signed manifest and checksums.` },
	{ label: "Platforms", text: "macOS (Apple silicon and Intel, signed and notarized), Windows x64, Linux x64 and arm64 (AppImage and .deb)." },
	{ label: "Agents", text: `${agentNames.join(", ")}.` },
	{ label: "Controller", text: "Bundled with the app on 127.0.0.1:18091. One gateway for Chat Completions, Completions, Anthropic Messages and Responses." },
	{ label: "License", text: `${site.upstream.license}, like ${site.upstream.name}.` },
	{ label: "Repository", text: "Source, releases, and issue tracking.", href: site.products.localStudio.repository, external: true },
];

const runtimes: readonly OverviewEntry[] = [
	{ label: "Discovery", text: "vLLM, SGLang, llama.cpp, LM Studio, or anything serving /v1/models on each machine." },
	{ label: "auto", text: "The model id auto routes to the busiest live model across your machines.", code: true },
	{ label: "Fleet", text: "Settings → Local finds tailnet machines. Connect existing controllers or install one over ssh with a shared fleet key." },
	{ label: "Registry", text: "Hardware-matched recipes from local-ai-registry, pinned weights, and Share to send a working config back as a pull request.", href: site.registry.repository, external: true },
];

const upstreamRows: readonly OverviewEntry[] = [
	{ label: "Authors", text: `${site.upstream.authors}. The thread UI, composer, terminal, source control, remote access and mobile app are their work.` },
	{ label: "Mobile", text: `The ${site.upstream.name} app pairs with Local Studio from Settings → Connections.`, href: site.upstream.appStore, external: true },
	{ label: "Repository", text: "Star and support the upstream project.", href: site.upstream.repository, external: true },
];

const shimRows: readonly OverviewEntry[] = [
	{
		label: "Extras",
		text: "Optional ChatGPT Codex passthrough, Cursor Composer passthrough, an Auto Router that picks the cheapest capable model per task, and a macOS patch that unhides custom catalog entries.",
	},
	{
		label: "Runtime",
		text: "Python 3.11+ / aiohttp, binds 127.0.0.1, configures through ~/.codex-shim/models.json. MIT.",
	},
	{
		label: "Repository",
		text: "Source and releases.",
		href: site.products.codexShim.repository,
		external: true,
	},
];

const machineRows: readonly OverviewEntry[] = [
	{
		label: "/machine",
		text: "The whole index as plain text: company, products, architecture, controller API, discovery.",
		href: "/machine",
		plain: true,
		code: true,
	},
	{
		label: "/llms.txt",
		text: "Curated markdown map of the site for language models.",
		href: "/llms.txt",
		plain: true,
		code: true,
	},
	{
		label: "/llms-full.txt",
		text: "Every markdown page in one file.",
		href: "/llms-full.txt",
		plain: true,
		code: true,
	},
	{
		label: "agent-card",
		text: "Agent card for agent-to-agent discovery at /.well-known/agent-card.json.",
		href: "/.well-known/agent-card.json",
		plain: true,
		code: true,
	},
	{
		label: "api-catalog",
		text: "Machine API catalog as linkset JSON at /.well-known/api-catalog.",
		href: "/.well-known/api-catalog",
		plain: true,
		code: true,
	},
	{
		label: "/sitemap.xml",
		text: "Crawler discovery for the canonical HTML routes; /sitemap.md is the markdown twin.",
		href: "/sitemap.xml",
		plain: true,
		code: true,
	},
	{
		label: "/robots.txt",
		text: "Crawl rules, AI bot policy, and content signals.",
		href: "/robots.txt",
		plain: true,
		code: true,
	},
];

const sourceRows: readonly OverviewEntry[] = [
	{ label: "local-studio", text: "The desktop app and controller. MIT.", href: site.products.localStudio.repository, external: true, code: true },
	{ label: "t3code", text: "Upstream T3 Code. MIT.", href: site.upstream.repository, external: true, code: true },
	{ label: "local-ai-registry", text: "Hardware records and recipes.", href: site.registry.repository, external: true, code: true },
	{ label: "codex-shim", text: "The BYOK Responses shim. MIT.", href: site.products.codexShim.repository, external: true, code: true },
	{ label: "local-studio-site", text: "This website.", href: site.source, external: true, code: true },
	{ label: "Sybil Solutions", text: "The company behind Local Studio. Software, AI, automation.", href: site.company.url, external: true },
];

function arrow(entry: OverviewEntry) {
	const Icon = entry.external ? ArrowUpRight : ArrowRight;
	return (
		<Icon
			{...stylex.props(styles.overviewArrow)}
			aria-hidden="true"
			size={14}
			strokeWidth={1.25}
		/>
	);
}

function OverviewLabel({ entry }: { entry: OverviewEntry }) {
	return (
		<span
			{...stylex.props(baseStyles.element, 
				styles.overviewLabel,
				entry.code && styles.overviewLabelCode,
			)}
		>
			{entry.label}
		</span>
	);
}

function OverviewRow({ entry }: { entry: OverviewEntry }) {
	let label: ReactNode;
	if (!entry.href) {
		label = <OverviewLabel entry={entry} />;
	} else if (entry.external) {
		label = (
			<a
				{...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, styles.overviewLink)}
				href={entry.href}
				target="_blank"
				rel="noreferrer"
			>
				<OverviewLabel entry={entry} />
				{arrow(entry)}
			</a>
		);
	} else if (entry.plain) {
		label = (
			<a {...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, styles.overviewLink)} href={entry.href}>
				<OverviewLabel entry={entry} />
				{arrow(entry)}
			</a>
		);
	} else {
		label = (
			<LocalLink sx={styles.overviewLink} href={entry.href}>
				<OverviewLabel entry={entry} />
				{arrow(entry)}
			</LocalLink>
		);
	}
	return (
		<li {...stylex.props(baseStyles.element, styles.overviewRow, styles.docsListItem)}>
			{label}
			<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.overviewText)}>{entry.text}</p>
		</li>
	);
}

export function ResourcesPage() {
	return (
		<PageShell>
			<PageIntro
				layout="left"
				id="resources-title"
				title={routes[overviewPath].heading}
				description="Documentation, setup paths, downloads, and the surrounding ecosystem in one place."
				actions={
					<CtaPair secondary={{ href: docsPath, label: "Read the docs" }} />
				}
			/>
			<DocsLayout toc={toc} path={overviewPath} label="Overview sections">
					<p {...stylex.props(baseStyles.element, baseStyles.paragraph)}>
						One page, everything on the map: the site, the desktop app, the
						upstream project, the shim, the machine surface, and where the source
						lives. If it exists around <span translate="no" {...stylex.props(baseStyles.element)}>Local Studio</span>,
						it is linked from here.
					</p>
					<section id="start-here" {...stylex.props(baseStyles.element, styles.docsSection)}>
						<h2 {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo, styles.docsSectionHeading)}>Start Here</h2>
						<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.docsSectionLead)}>
							Three ways in, depending on what you are holding.
						</p>
						<ul {...stylex.props(baseStyles.list, baseStyles.element, styles.overviewRows)}>
							{starts.map((entry) => (
								<OverviewRow entry={entry} key={entry.label} />
							))}
						</ul>
					</section>
					<section id="this-site" {...stylex.props(baseStyles.element, styles.docsSection)}>
						<h2 {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo, styles.docsSectionHeading)}>This Site</h2>
						<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.docsSectionLead)}>Every route and what it holds.</p>
						<ul {...stylex.props(baseStyles.list, baseStyles.element, styles.overviewRows)}>
							{siteRoutes.map((entry) => (
								<OverviewRow entry={entry} key={entry.label} />
							))}
						</ul>
					</section>
					<section id="local-studio" {...stylex.props(baseStyles.element, styles.docsSection)}>
						<h2 {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo, styles.docsSectionHeading)}>Local Studio</h2>
						<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.docsSectionLead)}>
							{upstreamCredit} It adds Pi and Oh My Pi, a bundled controller, a fleet over Tailscale and local-ai-registry recipes, under a strict budget of its own code so upstream improvements arrive quickly.
						</p>
						<ul {...stylex.props(baseStyles.list, baseStyles.element, styles.overviewRows)}>
							{studioFacts.map((entry) => (
								<OverviewRow entry={entry} key={entry.label} />
							))}
						</ul>
					</section>
					<section id="runtimes" {...stylex.props(baseStyles.element, styles.docsSection)}>
						<h2 {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo, styles.docsSectionHeading)}>Models and Machines</h2>
						<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.docsSectionLead)}>
							Each machine runs its own controller. Controllers that share a fleet key link into one graph, so a model loaded anywhere is usable everywhere.
						</p>
						<ul {...stylex.props(baseStyles.list, baseStyles.element, styles.overviewRows)}>
							{runtimes.map((entry) => (
								<OverviewRow entry={entry} key={entry.label} />
							))}
						</ul>
					</section>
					<section id="upstream" {...stylex.props(baseStyles.element, styles.docsSection)}>
						<h2 {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo, styles.docsSectionHeading)}>{site.upstream.name}</h2>
						<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.docsSectionLead)}>
							The open-source agent harness Local Studio is built on, used under the {site.upstream.license} License. Local Studio is a thin fork that tracks it closely.
						</p>
						<ul {...stylex.props(baseStyles.list, baseStyles.element, styles.overviewRows)}>
							{upstreamRows.map((entry) => (
								<OverviewRow entry={entry} key={entry.label} />
							))}
						</ul>
					</section>
					<section id="codex-shim" {...stylex.props(baseStyles.element, styles.docsSection)}>
						<h2 {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo, styles.docsSectionHeading)}>Codex Shim</h2>
						<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.docsSectionLead)}>
							A local Python/aiohttp server that exposes an OpenAI
							Responses-compatible endpoint on loopback, so Codex Desktop can
							run BYOK models: OpenAI, Anthropic, Z.ai, DeepSeek, Gemini,
							OpenRouter, and local proxies. Codex keeps its native UX; routing
							moves local.
						</p>
						<ul {...stylex.props(baseStyles.list, baseStyles.element, styles.overviewRows)}>
							{shimRows.map((entry) => (
								<OverviewRow entry={entry} key={entry.label} />
							))}
						</ul>
					</section>
					<section id="for-machines" {...stylex.props(baseStyles.element, styles.docsSection)}>
						<h2 {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo, styles.docsSectionHeading)}>For Machines</h2>
						<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.docsSectionLead)}>
							Every HTML route above has a markdown twin: append{" "}
							<code {...stylex.props(baseStyles.element, baseStyles.monospace, styles.docsInlineCode)}>.md</code> or send <code {...stylex.props(baseStyles.element, baseStyles.monospace, styles.docsInlineCode)}>Accept: text/markdown</code>. The
							homepage advertises the catalog, docs, and agent card through RFC
							8288 Link headers.
						</p>
						<pre {...stylex.props(baseStyles.element, baseStyles.monospace, styles.docsCode)}>
							curl -H "Accept: text/markdown" {site.origin}{docsPath}
						</pre>
						<ul {...stylex.props(baseStyles.list, baseStyles.element, styles.overviewRows)}>
							{machineRows.map((entry) => (
								<OverviewRow entry={entry} key={entry.label} />
							))}
						</ul>
					</section>
					<section id="source" {...stylex.props(baseStyles.element, styles.docsSection)}>
						<h2 {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo, styles.docsSectionHeading)}>Source and Company</h2>
						<ul {...stylex.props(baseStyles.list, baseStyles.element, styles.overviewRows)}>
							{sourceRows.map((entry) => (
								<OverviewRow entry={entry} key={entry.label} />
							))}
						</ul>
					</section>
			</DocsLayout>
			<PageCta id="resources-cta-title" />
		</PageShell>
	);
}
