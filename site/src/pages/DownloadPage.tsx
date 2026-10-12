import { baseStyles } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { CtaPair } from "../components/Links";
import { DocsLayout } from "../components/DocsLayout";
import { PageIntro } from "../components/PageIntro";
import { PageShell } from "../components/PageShell";
import { downloadPath, routes, setupPath } from "../domain/route";
import {
	detectPlatform,
	downloadGroups,
	downloadHref,
	downloadTargets,
	release,
	type DownloadGroup,
	type Platform,
	type ReleaseSummary,
} from "../domain/release";
import { site } from "../domain/site";
import { styles } from "../styles/pages-styles";

const primaryTarget = { macos: "macos", windows: "windows", linux: "linux" } as const;
const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

function formatSize(bytes: number): string {
	return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

function useRelease(): ReleaseSummary | null {
	const [summary, setSummary] = useState<ReleaseSummary | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		fetch(release.api, { signal: controller.signal })
			.then((response) => (response.ok ? response.json() : null))
			.then((body: ReleaseSummary | null) => setSummary(body?.assets ? body : null))
			.catch(() => setSummary(null));
		return () => controller.abort();
	}, []);
	return summary;
}

function FileLink({ href, external, inline = false, children }: { href: string; external: boolean; inline?: boolean; children: ReactNode }) {
	const props = stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, inline ? styles.downloadInlineLink : styles.overviewLink);
	return external ? (
		<a {...props} href={href} target="_blank" rel="noreferrer">
			{children}
		</a>
	) : (
		<a {...props} href={href}>
			{children}
		</a>
	);
}

function Group({ group, summary, recommended }: { group: DownloadGroup; summary: ReleaseSummary | null; recommended: boolean }) {
	return (
		<section id={group.id} {...stylex.props(baseStyles.element, styles.docsSection)}>
			<h2 {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo, styles.docsSectionHeading)}>
				{group.title}
				{recommended ? <span {...stylex.props(baseStyles.element, styles.downloadBadge)}>Your system</span> : null}
			</h2>
			<ul {...stylex.props(baseStyles.list, baseStyles.element, styles.overviewRows)}>
				{group.rows.map((row) => {
					const asset = summary?.assets.find((entry) => row.match.test(entry.name)) ?? null;
					const href = row.target ? downloadHref(row.target) : (asset?.url ?? release.latest);
					return (
						<li key={`${row.label}-${row.detail}`} {...stylex.props(baseStyles.element, styles.overviewRow, styles.docsListItem)}>
							<span {...stylex.props(baseStyles.element, styles.overviewLabel)}>
								{row.label}
								<span {...stylex.props(baseStyles.element, styles.downloadDetail)}>{row.detail}</span>
							</span>
							<div {...stylex.props(baseStyles.element, styles.downloadFile)}>
								<FileLink href={href} external={!row.target && !asset}>
									<span {...stylex.props(baseStyles.element, styles.overviewLabel, styles.overviewLabelCode)}>
										{asset?.name ?? (row.target ? downloadTargets[row.target].asset : "GitHub Releases")}
									</span>
									{asset || row.target ? (
										<ArrowDown {...stylex.props(styles.overviewArrow)} aria-hidden="true" size={14} strokeWidth={1.25} />
									) : (
										<ArrowUpRight {...stylex.props(styles.overviewArrow)} aria-hidden="true" size={14} strokeWidth={1.25} />
									)}
								</FileLink>
								{asset ? (
									<span {...stylex.props(baseStyles.element, styles.downloadDetail)}>
										{formatSize(asset.size)} · <span title={`SHA-256 ${asset.sha256}`}>sha256 {asset.sha256.slice(0, 12)}</span>
									</span>
								) : null}
							</div>
						</li>
					);
				})}
			</ul>
			{group.notes.map((note) => (
				<p key={note} {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.marginTop16)}>{note}</p>
			))}
		</section>
	);
}

export function DownloadPage() {
	const summary = useRelease();
	const [platform] = useState<Platform | null>(() => detectPlatform(navigator.userAgent));
	const target = primaryTarget[platform ?? "macos"];
	const groups = [...downloadGroups].sort((left, right) => Number(right.id === platform) - Number(left.id === platform));
	return (
		<PageShell>
			<PageIntro
				layout="left"
				id="download-page-title"
				title={routes[downloadPath].heading}
				description={
					<>
						Every coding agent on your own models, for macOS, Windows and Linux.
						<small {...stylex.props(baseStyles.element, styles.downloadMeta)}>
							<span {...stylex.props(baseStyles.element)}>
								{summary ? `Version ${summary.version}` : `Version ${release.major}`}
								{summary?.publishedAt ? ` · ${dateFormatter.format(new Date(summary.publishedAt))}` : ""}
							</span>
							<FileLink href={summary?.pageUrl ?? release.latest} external inline>Release notes</FileLink>
							{summary?.sumsUrl ? <FileLink href={summary.sumsUrl} external={false} inline>{release.sums}</FileLink> : null}
						</small>
					</>
				}
				actions={
					<CtaPair
						primary={{ href: downloadHref(target), label: `Download for ${downloadTargets[target].label}` }}
						secondary={{ href: setupPath, label: "Setup Prompt" }}
					/>
				}
			/>
			<DocsLayout toc={downloadGroups.map((group) => [group.title, group.id] as const)} path={downloadPath} label="Download sections">
				<p {...stylex.props(baseStyles.element, baseStyles.paragraph)}>
					Every platform link checks the release manifest and the file&apos;s SHA-256 digest before it redirects to GitHub. Verify any file with{" "}
					<code {...stylex.props(baseStyles.element, baseStyles.monospace, styles.docsInlineCode)}>shasum -a 256</code> against {release.sums}.
				</p>
				{groups.map((group) => (
					<Group key={group.id} group={group} summary={summary} recommended={group.id === platform} />
				))}
				<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.docsNotice, styles.marginTop32)}>
					{site.products.localStudio.name} is built on{" "}
					<FileLink href={site.upstream.repository} external inline>{site.upstream.name}</FileLink> by {site.upstream.authors}, used under the{" "}
					{site.upstream.license} License. {site.products.localStudio.name}&apos;s own changes are released under the same license.
				</p>
			</DocsLayout>
		</PageShell>
	);
}
