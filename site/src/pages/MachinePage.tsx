import { baseStyles } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import localStudioAscii from "../content/local-studio-ascii.txt?raw";
import { machineSections } from "../agent/machine";
import { machinePath, routePaths, routes } from "../domain/route";
import { LocalLink } from "../components/LocalLink";
import { PageShell } from "../components/PageShell";
import { site } from "../domain/site";
import { styles } from "../styles/pages-styles";

const sections = machineSections();

export function MachinePage() {
	return (
		<PageShell>
			<div {...stylex.props(baseStyles.element, styles.machine)} data-page-focus>
				<div {...stylex.props(baseStyles.element, styles.machineInner)}>
					<LocalLink
						sx={styles.machineBanner}
						href="/"
						aria-label={`Back to ${site.products.localStudio.name}`}
					>
						<pre {...stylex.props(baseStyles.element, baseStyles.monospace, styles.machineBannerPre)}>{localStudioAscii}</pre>
					</LocalLink>
					<h1
						{...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingOne, styles.machineTitle)}
						aria-label={routes[machinePath].heading}
					>
						<span translate="no" {...stylex.props(baseStyles.element)}>sybil solutions</span> /{" "}
						<span translate="no" {...stylex.props(baseStyles.element)}>local studio</span> :: machine-readable index
					</h1>
					<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.machineNote)}>
						dense plain-text index of the company, products, APIs, and discovery
						files. agents: prefer /llms.txt or Accept: text/markdown.
					</p>
					<nav
						{...stylex.props(baseStyles.element, styles.machineRoutes)}
						aria-label="Site routes"
					>
						{routePaths.map((route) => (
							<LocalLink
								sx={styles.machineRoute}
								href={route}
								key={route}
							>
								{route}
							</LocalLink>
						))}
					</nav>
					{sections.map(([name, lines]) => (
						<section key={name} {...stylex.props(baseStyles.element)}>
							<h2 {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo, styles.machineSectionHeading)}>── {name}</h2>
							<pre {...stylex.props(baseStyles.element, baseStyles.monospace, styles.machineSectionPre)}>{lines.join("\n")}</pre>
						</section>
					))}
					<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.machineEnd)}>:: end of index ::</p>
				</div>
			</div>
		</PageShell>
	);
}
