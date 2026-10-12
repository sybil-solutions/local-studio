import { baseStyles, type PublicStyle } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { colors, constants, lengths, times } from "../styles/public-tokens.stylex";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { downloadLabel, downloadPath } from "../domain/route";
import { LocalLink } from "./LocalLink";

interface TextLinkProps
	extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "style"> {
	children: ReactNode;
	href: string;
	sx?: PublicStyle;
}

interface Cta {
	href: string;
	label: ReactNode;
}

interface CtaPairProps {
	primary?: Cta;
	secondary: Cta;
	sx?: PublicStyle;
}


const downloadCta = {
	href: downloadPath,
	label: downloadLabel(),
} satisfies Cta;

const styles = stylex.create({
	textLink: {
		display: "inline-flex",
		minHeight: {
			default: 0,
			"@media (max-width: 620px)": "44px",
		},
		alignItems: "center",
		gap: "4px",
		color: {
			default: colors.dim,
			"@media (hover: hover)": {
				default: colors.dim,
				":hover": colors.foreground,
			},
		},
		fontFamily: constants.fontSans,
		fontSize: "16px",
		fontWeight: 400,
		lineHeight: "24px",
		textDecoration: "none",
		transitionProperty: "color",
		transitionDuration: times.fast,
		transitionTimingFunction: "ease-out",
	},
	button: {
		display: "inline-flex",
		width: "auto",
		minHeight: "40px",
		alignItems: "center",
		justifyContent: "center",
		gap: "8px",
		paddingBlock: '0',
		paddingInline: '16px',
		borderWidth: '1px',
		borderStyle: 'solid',
		borderRadius: lengths.radiusControl,
		color: colors.buttonInk,
		backgroundColor: colors.foreground,
		borderColor: colors.foreground,
		boxShadow: {
			default: `0 6px 20px ${colors.shadowControl}, 0 1px 6px ${colors.shadowControlDirect}`,
			"@media (hover: hover)": {
				":hover": `0 8px 24px ${colors.shadowControl}, 0 2px 8px ${colors.focusHalo}`,
			},
		},
		fontWeight: 500,
		textDecoration: "none",
		transitionProperty: "color, background, border-color, box-shadow",
		transitionDuration: times.fast,
		transitionTimingFunction: "ease-out",
	},
	group: {
		display: "inline-flex",
		width: {
			default: "auto",
			"@media (max-width: 620px)": "100%",
		},
		maxWidth: "100%",
		minWidth: 0,
		flexDirection: "row",
		flexWrap: "nowrap",
		alignItems: "stretch",
		gap: "8px",
	},
	groupItem: {
		flexGrow: { default: 0, "@media (max-width: 620px)": 1 },
		flexShrink: 1,
		flexBasis: "auto",
		width: "auto",
		minWidth: 0,
		height: "auto",
		minHeight: {
			default: "40px",
			"@media (max-width: 620px)": "44px",
		},
		paddingInline: {
			default: "16px",
			"@media (max-width: 620px)": "8px",
		},
		paddingBlock: 0,
		fontSize: {
			default: "16px",
			"@media (max-width: 620px)": "14px",
		},
		textAlign: "center",
		lineHeight: "20px",
		whiteSpace: "nowrap",
	},
	secondary: {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		paddingBlock: '0',
		paddingInline: '16px',
		borderWidth: '1px',
		borderStyle: 'solid',
		borderRadius: lengths.radiusControl,
		color: colors.foreground,
		backgroundColor: {
			default: "transparent",
			"@media (hover: hover)": {
				default: "transparent",
				":hover": colors.hover,
			},
		},
		borderColor: colors.borderStrong,
		boxShadow: `inset 0 1px 0 ${colors.borderSoft}`,
		fontWeight: 400,
		transitionProperty: "color, background, border-color, box-shadow",
		transitionDuration: times.fast,
		transitionTimingFunction: "ease-out",
	},
});

function TextLink({ children, href, sx, ...props }: TextLinkProps) {
	return (
		<LocalLink sx={[styles.textLink, sx]} href={href} {...props}>
			{children}
		</LocalLink>
	);
}

export function DownloadButton({ sx }: { sx?: PublicStyle }) {
	return (
		<LocalLink sx={[styles.button, sx]} href={downloadCta.href}>
			{downloadCta.label}
		</LocalLink>
	);
}

export function CtaPair({ primary = downloadCta, secondary, sx }: CtaPairProps) {
	return (
		<div data-cta-pair {...stylex.props(baseStyles.element, styles.group, sx)}>
			<LocalLink sx={[styles.button, styles.groupItem]} href={primary.href}>
				{primary.label}
			</LocalLink>
			<TextLink sx={[styles.secondary, styles.groupItem]} href={secondary.href}>
				{secondary.label}
			</TextLink>
		</div>
	);
}
