import { baseStyles } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { docsPath, downloadPath, routes, setupPath } from "../domain/route";
import { CtaPair } from "../components/Links";
import { DocsLayout } from "../components/DocsLayout";
import { LocalLink } from "../components/LocalLink";
import { PageIntro } from "../components/PageIntro";
import { PageShell } from "../components/PageShell";
import { agentNames, controllerRoutes, upstreamCredit } from "../content/facts";
import { site } from "../domain/site";
import { styles } from "../styles/pages-styles";

const toc = [
	["Install", "install"],
	["Agents", "agents"],
	["Local Models", "local-models"],
	["Fleet", "fleet"],
	["Registry", "registry"],
	["Phone", "phone"],
	["Controller API", "controller-api"],
	["Upgrading from 2.x", "upgrading"],
] as const;

function Code({ children }: { children: ReactNode }) {
	return <code {...stylex.props(baseStyles.element, baseStyles.monospace, styles.docsInlineCode)}>{children}</code>;
}

function Section({ id, title, lead, children }: { id: string; title: string; lead: ReactNode; children?: ReactNode }) {
	return (
		<section id={id} {...stylex.props(baseStyles.element, styles.docsSection)}>
			<h2 {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo, styles.docsSectionHeading)}>{title}</h2>
			<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.docsSectionLead)}>{lead}</p>
			{children}
		</section>
	);
}

function List({ items }: { items: readonly ReactNode[] }) {
	return (
		<ul {...stylex.props(baseStyles.list, baseStyles.element, styles.marginTop16, styles.docsList)}>
			{items.map((item, index) => (
				<li key={index} {...stylex.props(baseStyles.element, styles.docsListItem)}>{item}</li>
			))}
		</ul>
	);
}

function Pre({ children }: { children: string }) {
	return <pre {...stylex.props(baseStyles.element, baseStyles.monospace, styles.docsCode)}>{children}</pre>;
}

export function DocsPage() {
	const name = site.products.localStudio.name;
	return (
		<PageShell>
			<PageIntro
				layout="left"
				id="docs-title"
				title={routes[docsPath].heading}
				description="Install the app, connect your agents, serve local models, link your machines and pair a phone."
				actions={<CtaPair secondary={{ href: setupPath, label: "Setup Prompt" }} />}
			/>
			<DocsLayout toc={toc} path={docsPath} label="Documentation sections">
				<p {...stylex.props(baseStyles.element, baseStyles.paragraph)}>
					<span translate="no" {...stylex.props(baseStyles.element)}>{name}</span> is a desktop app that runs every coding agent
					on your own models. {upstreamCredit} The{" "}
					<a {...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, styles.overviewTextLink)} href={site.upstream.repository} target="_blank" rel="noreferrer">
						upstream documentation
					</a>{" "}
					still describes most of the app.
				</p>
				<Section
					id="install"
					title="Install"
					lead={<>Get the installer for your system from the <LocalLink sx={styles.overviewTextLink} href={downloadPath}>download page</LocalLink>.</>}
				>
					<List
						items={[
							<>macOS: open the DMG and drag {name} into Applications. Builds are signed and notarized, and the app updates itself.</>,
							<>Windows: the installer is not code-signed yet. If SmartScreen appears, choose More info, then Run anyway.</>,
							<>Linux: <Code>chmod +x</Code> the AppImage and run it, or <Code>sudo apt install ./Local-Studio-*.deb</Code>.</>,
						]}
					/>
				</Section>
				<Section
					id="agents"
					title="Agents"
					lead={<>Install and log in to at least one agent CLI before first use: {agentNames.join(", ")}. Pi needs <Code>pi</Code> and Oh My Pi needs <Code>omp</Code>; both use their own configured models and credentials.</>}
				>
					<List
						items={[
							"Pi and Oh My Pi stream text, reasoning and tool calls, and support steering, interrupt, compaction, rollback, and model and thinking selection.",
							"Existing Pi and Oh My Pi sessions can be imported during onboarding.",
						]}
					/>
				</Section>
				<Section
					id="local-models"
					title="Local Models"
					lead={<>The app starts its bundled controller on <Code>127.0.0.1:18091</Code> unless one is already running. It discovers vLLM, SGLang, llama.cpp, LM Studio and anything serving <Code>/v1/models</Code>.</>}
				>
					<List
						items={[
							<>One gateway: <Code>/v1/chat/completions</Code>, <Code>/v1/completions</Code>, <Code>/v1/messages</Code> and <Code>/v1/responses</Code>. Streams and errors pass through.</>,
							<>The model id <Code>auto</Code> picks the live model with the most successful requests.</>,
							"Pinned registry recipes launch on free NVIDIA GPUs and never evict running engines.",
							<>Configuration lives in <Code>~/.local-studio-t3/config.json</Code> (mode 0600): machine name, URL, <Code>fleetKey</Code> and peers.</>,
						]}
					/>
				</Section>
				<Section
					id="fleet"
					title="Fleet"
					lead="Settings → Local shows every connected machine with its GPUs, memory, live models, launchable recipes and usage. Scan tailnet lists the Linux and macOS machines on your Tailscale network."
				>
					<List
						items={[
							"Connect links a machine that already runs a controller.",
							"Install sets one up over ssh as a systemd or launchd user service, bound to the machine's Tailscale address, with your fleet key. It needs key-based ssh access and never overwrites an existing controller.",
							"Keep the fleet key private. Every controller route except /api/health requires it.",
						]}
					/>
				</Section>
				<Section
					id="registry"
					title="Registry"
					lead="Settings → Local matches your GPUs, or your Apple chip and its unified memory, against local-ai-registry hardware records."
				>
					<List
						items={[
							"All hardware browses every registry model, grouped by model with the best variant first.",
							"Inspect shows the records, Use config copies the launch command and Download weights fetches the pinned revision.",
							"Share turns a running server into registry records, removes credentials, paths, hostnames and private addresses, and opens a pull request with your own gh login after you confirm.",
						]}
					/>
				</Section>
				<Section
					id="phone"
					title="Phone"
					lead={<>{name} is a {site.upstream.name} server. Pair the {site.upstream.name} mobile app or a mobile browser from Settings → Connections, over your LAN or Tailscale.</>}
				/>
				<Section
					id="controller-api"
					title="Controller API"
					lead={<>Send the fleet key as <Code>Authorization: Bearer</Code> on every route except <Code>/api/health</Code>. The <a {...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, styles.overviewTextLink)} href="/agents.md">agent sheet</a> has the full list.</>}
				>
					<List items={controllerRoutes.map(([route, purpose]) => <><Code>{route}</Code> {purpose}</>)} />
					<Pre>{`KEY=$(jq -r .fleetKey ~/.local-studio-t3/config.json)
curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1:18091/v1/models`}</Pre>
				</Section>
				<Section
					id="upgrading"
					title="Upgrading from 2.x"
					lead={<>3.x is a new app with a new data folder; your 2.x data is left untouched. Installing on macOS replaces the 2.x app, and 2.x does not auto-update to 3.x. A 2.x controller on a GPU machine can keep running beside the 3.x controller.</>}
				/>
			</DocsLayout>
		</PageShell>
	);
}
