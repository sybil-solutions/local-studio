import { baseStyles, type PublicStyle } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { colors, lengths, times } from "../styles/public-tokens.stylex";
import type { ReactNode } from "react";
import { LocalLink } from "./LocalLink";

type TocEntry = readonly [label: string, id: string];


const pageWidth =
	`min(${lengths.pageWidth}, calc(100% - ${lengths.pageGutter}))`;

const styles = stylex.create({
	root: {
		display: "grid",
		gridTemplateColumns: {
			default: "240px minmax(0, 1fr)",
			"@media (max-width: 900px)": "minmax(0, 1fr)",
		},
		width: pageWidth,
		gap: "48px",
		marginInline: "auto",
		paddingBottom: "120px",
	},
	toc: {
		position: {
			default: "sticky",
			"@media (max-width: 900px)": "static",
		},
		top: "96px",
		alignSelf: "start",
	},
	label: {
		color: colors.dim,
		fontSize: "16px",
		lineHeight: "24px",
	},
	list: {
		display: "grid",
		gap: { default: "8px", "@media (max-width: 900px)": 0 },
		marginTop: "16px",
		paddingTop: '0',
		paddingRight: '0',
		paddingBottom: '0',
		paddingLeft: '16px',
		borderLeftWidth: '1px',
		borderLeftStyle: 'solid',
		borderLeftColor: colors.borderSoft,
		fontSize: "16px",
		lineHeight: "24px",
	},
	link: {
		display: "flex",
		minHeight: { default: "24px", "@media (max-width: 900px)": "44px" },
		alignItems: "center",
		color: {
			default: colors.dim,
			"@media (hover: hover)": {
				default: colors.dim,
				":hover": colors.foreground,
			},
		},
		transitionProperty: "color",
		transitionDuration: times.fast,
		transitionTimingFunction: "ease-out",
	},
	prose: {
		minWidth: 0,
		color: colors.fine,
		fontSize: "16px",
		lineHeight: "24px",
	},
});

export function DocsLayout({
	toc,
	path,
	label,
	children,
	sx,
}: {
	toc: readonly TocEntry[];
	path: string;
	label: string;
	children: ReactNode;
	sx?: PublicStyle;
}) {
	return (
		<div {...stylex.props(baseStyles.element, styles.root, sx)}>
			<aside {...stylex.props(baseStyles.element, styles.toc)}>
				<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.label)}>On this page</p>
				<nav aria-label={label} {...stylex.props(baseStyles.element)}>
					<ul {...stylex.props(baseStyles.list, baseStyles.element, styles.list)}>
						{toc.map(([title, id]) => (
							<li key={id} {...stylex.props(baseStyles.element)}>
								<LocalLink sx={styles.link} href={`${path}#${id}`}>
									{title}
								</LocalLink>
							</li>
						))}
					</ul>
				</nav>
			</aside>
			<article {...stylex.props(baseStyles.element, styles.prose)}>{children}</article>
		</div>
	);
}
