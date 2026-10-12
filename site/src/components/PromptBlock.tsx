import { baseStyles, type PublicStyle } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { colors, constants, lengths, times } from "../styles/public-tokens.stylex";
import { useId, useState } from "react";
import { CopyButton } from "./CopyButton";

interface PromptBlockProps {
	label: string;
	sx?: PublicStyle;
	text: string;
}


const styles = stylex.create({
	root: {
		position: "relative",
		minWidth: 0,
		overflow: "visible",
		borderWidth: '1px',
		borderStyle: 'solid',
		borderColor: colors.borderStrong,
		borderRadius: lengths.radiusPanel,
		boxShadow: `inset 0 1px 0 ${colors.borderSoft}`,
	},
	collapsedRoot: {
		"::after": {
			content: '""',
			position: "absolute",
			zIndex: 0,
			right: "2px",
			bottom: "2px",
			left: "2px",
			height: "160px",
			borderBottomRightRadius: `calc(${lengths.radiusPanel} - 2px)`,
			borderBottomLeftRadius: `calc(${lengths.radiusPanel} - 2px)`,
			pointerEvents: "none",
			backgroundImage: `linear-gradient(to bottom, transparent, ${colors.background} 88%)`,
		},
	},
	pre: {
		width: "100%",
		maxWidth: "100%",
		minWidth: 0,
		overflow: "hidden",
		margin: 0,
		padding: {
			default: "32px 80px 32px 32px",
			"@media (max-width: 620px)": "20px 48px 20px 20px",
		},
		color: colors.fine,
		fontFamily: constants.fontMono,
		fontSize: "16px",
		lineHeight: "24px",
		whiteSpace: "pre-wrap",
		overflowWrap: "anywhere",
		wordBreak: "break-word",
	},
	collapsed: {
		maxHeight: {
			default: "420px",
			"@media (max-width: 620px)": "320px",
		},
	},
	code: {
		maxWidth: "100%",
		whiteSpace: "pre-wrap",
		overflowWrap: "anywhere",
		wordBreak: "break-word",
	},
	toggle: {
		position: "absolute",
		zIndex: 1,
		bottom: 0,
		left: "50%",
		display: "inline-flex",
		minHeight: { default: "40px", "@media (max-width: 620px)": "44px" },
		alignItems: "center",
		paddingBlock: '0',
		paddingInline: '20px',
		borderWidth: '1px',
		borderStyle: 'solid',
		borderColor: {
			default: colors.borderStrong,
			"@media (hover: hover)": {
				default: colors.borderStrong,
				":hover": colors.borderStrongHover,
			},
		},
		borderRadius: lengths.radiusControl,
		color: colors.foreground,
		backgroundColor: colors.background,
		fontFamily: constants.fontSans,
		fontSize: "16px",
		fontWeight: 400,
		lineHeight: "24px",
		transform: "translate(-50%, 50%)",
		boxShadow: `0 8px 24px ${colors.shadowControl}, 0 2px 8px ${colors.shadowControlDirect}`,
		transitionProperty: "color, border-color, box-shadow",
		transitionDuration: times.fast,
		transitionTimingFunction: "ease-out",
		cursor: "pointer",
	},
});

export function PromptBlock({ label, sx, text }: PromptBlockProps) {
	const [expanded, setExpanded] = useState(false);
	const contentId = useId();

	return (
		<section
			{...stylex.props(baseStyles.element, styles.root, !expanded && styles.collapsedRoot, stylex.defaultMarker(), sx)}
			aria-label={label}
			data-expanded={expanded ? "true" : "false"}
		>
			<CopyButton text={text} />
			<pre
				id={contentId}
			{...stylex.props(baseStyles.element, baseStyles.monospace, styles.pre, !expanded && styles.collapsed)}
			>
				<code {...stylex.props(baseStyles.element, baseStyles.monospace, styles.code)}>{text}</code>
			</pre>
			<button
				{...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, baseStyles.button, styles.toggle)}
				type="button"
				aria-expanded={expanded}
				aria-controls={contentId}
				onClick={() => setExpanded((value) => !value)}
			>
				{expanded ? "Show Less" : "Show More"}
			</button>
		</section>
	);
}
