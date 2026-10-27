import { baseStyles } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { homePath, notFoundSuggestions } from "../domain/route";
import { site } from "../domain/site";
import { LocalLink } from "../components/LocalLink";
import { PageIntro } from "../components/PageIntro";
import { PageShell } from "../components/PageShell";
import { styles } from "../styles/pages-styles";

export function NotFoundPage() {
	return (
		<PageShell>
			<PageIntro
				id="not-found-title"
				title="This page is not local"
				description={
					<>
						The route does not exist in this{" "}
						<span translate="no" {...stylex.props(baseStyles.element)}>{site.products.localStudio.name}</span> website. Try one of the
						routes below instead.
					</>
				}
				actions={
					<LocalLink sx={styles.button} href={homePath}>
						Back to <span translate="no" {...stylex.props(baseStyles.element)}>{site.products.localStudio.name}</span>
					</LocalLink>
				}
			>
				<nav
					{...stylex.props(baseStyles.element, styles.notFoundRoutes)}
					aria-label="Suggested routes"
				>
					{notFoundSuggestions().map(({ label, href }) => (
						<LocalLink
							sx={styles.notFoundRoute}
							href={href}
							key={href}
						>
							{label}
						</LocalLink>
					))}
				</nav>
			</PageIntro>
		</PageShell>
	);
}
