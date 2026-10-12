import { baseStyles, type PublicStyle } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { colors, constants, lengths } from "../styles/public-tokens.stylex";
import { footerRoutes } from "../domain/route";
import { site } from "../domain/site";
import { LocalLink } from "./LocalLink";

const pageWidth =
	`min(${lengths.pageWidth}, calc(100% - ${lengths.pageGutter}))`;

const styles = stylex.create({
	root: {
		position: "relative",
		isolation: "isolate",
		display: "grid",
		gridTemplateColumns: {
			default: "1fr auto",
			"@media (max-width: 620px)": "minmax(0, 1fr)",
		},
		width: pageWidth,
		alignItems: "end",
		gap: "32px",
		marginTop: "auto",
		marginInline: "auto",
		paddingTop: '80px',
		paddingRight: '0',
		paddingBottom: 'calc(48px + env(safe-area-inset-bottom,0px))',
		paddingLeft: '0',
		color: colors.chrome,
		fontFamily: constants.fontSans,
		fontSize: "16px",
		fontWeight: 400,
		lineHeight: "24px",
	},
	copyright: {
		order: {
			default: 1,
			"@media (max-width: 620px)": 2,
		},
	},
	links: {
		order: {
			default: 2,
			"@media (max-width: 620px)": 1,
		},
		display: {
			default: "flex",
			"@media (max-width: 620px)": "grid",
		},
		gridTemplateColumns: {
			default: "none",
			"@media (max-width: 620px)": "repeat(2, minmax(0, 1fr))",
		},
		flexWrap: "wrap",
		justifyContent: {
			default: "flex-end",
			"@media (max-width: 620px)": "stretch",
		},
		columnGap: {
			default: 0,
			"@media (max-width: 620px)": "24px",
		},
		rowGap: 0,
	},
	credit: {
		color: {
			default: colors.chrome,
			"@media (hover: hover)": {
				default: colors.chrome,
				":hover": colors.foreground,
			},
		},
		textDecoration: "underline",
		textUnderlineOffset: "3px",
	},
	link: {
		display: "flex",
		minHeight: {
			default: "32px",
			"@media (max-width: 620px)": "44px",
		},
		alignItems: "center",
		padding: {
			default: "4px 12px",
			"@media (max-width: 620px)": "6px 0",
		},
		color: {
			default: colors.chrome,
			"@media (hover: hover)": {
				default: colors.chrome,
				":hover": colors.foreground,
			},
		},
		textDecoration: "none",
	},
});

export function Footer({ sx }: { sx?: PublicStyle }) {
	return (
		<footer {...stylex.props(baseStyles.element, styles.root, sx)}>
			<nav {...stylex.props(baseStyles.element, styles.links)} aria-label="Footer navigation">
				{footerRoutes().map(({ label, path }) => (
					<LocalLink sx={styles.link} href={path} key={path}>
						{label}
					</LocalLink>
				))}
				<a {...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, styles.link)} href="/developers">
					Developers
				</a>
				<a {...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, styles.link)} href="/openapi.json">
					API
				</a>
			</nav>
			<span {...stylex.props(baseStyles.element, styles.copyright)}>
				© {site.copyrightYear}{" "}
				<span translate="no" {...stylex.props(baseStyles.element)}>{site.products.localStudio.name}</span>
				{" · Built on "}
				<a {...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, styles.credit)} href={site.upstream.repository} target="_blank" rel="noreferrer">
					{site.upstream.name}
				</a>
				{` (${site.upstream.license})`}
			</span>
		</footer>
	);
}
