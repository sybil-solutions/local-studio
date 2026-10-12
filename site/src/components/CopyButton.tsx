import { baseStyles, type PublicStyle } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { colors, lengths, times } from "../styles/public-tokens.stylex";
import { useState } from "react";

interface CopyButtonProps {
	sx?: PublicStyle;
	text: string;
}

const copyPath =
	"M8.25 2c.14 0 .25.11.25.25V3H10v-.75C10 1.28 9.22.5 8.25.5h-5.5C1.78.5 1 1.28 1 2.25v7.5c0 .97.78 1.75 1.75 1.75H4.5V10H2.75a.25.25 0 0 1-.25-.25v-7.5c0-.14.11-.25.25-.25zm5 4c.14 0 .25.11.25.25v7.5q-.02.23-.25.25h-5.5a.25.25 0 0 1-.25-.25v-7.5c0-.14.11-.25.25-.25zm0 9.5c.97 0 1.75-.78 1.75-1.75v-7.5c0-.97-.78-1.75-1.75-1.75h-5.5C6.78 4.5 6 5.28 6 6.25v7.5c0 .97.78 1.75 1.75 1.75z";
const checkPath =
	"m15.56 4-.53.53-8.8 8.8c-.68.68-1.78.68-2.47 0l.53-.54-.53.53-2.79-2.79L.44 10 1.5 8.94l.53.53 2.8 2.8c.1.09.25.09.35 0l8.79-8.8.53-.53z";


const styles = stylex.create({
	clipboard: { position: "fixed", opacity: 0 },
	button: {
		position: "absolute",
		zIndex: 3,
		top: "14px",
		right: "14px",
		display: "inline-flex",
		width: { default: "32px", "@media (max-width: 620px)": "44px" },
		height: { default: "32px", "@media (max-width: 620px)": "44px" },
		alignItems: "center",
		justifyContent: "center",
		padding: 0,
		borderWidth: "1px",
		borderRadius: lengths.radiusControl,
		color: colors.foreground,
		backgroundColor: {
			default: "transparent",
			"@media (hover: hover)": {
				default: "transparent",
				":hover": colors.hover,
			},
		},
		cursor: "pointer",
		opacity: 1,
		borderStyle: "solid",
		borderColor: {
			default: colors.borderStrong,
			"@media (hover: hover)": {
				default: colors.borderStrong,
				":hover": colors.borderStrongHover,
			},
		},
		boxShadow: `0 8px 24px ${colors.shadowControl}, 0 2px 8px ${colors.shadowControlDirect}`,
		transitionProperty: "background, border-color, box-shadow",
		transitionDuration: times.fast,
		transitionTimingFunction: "ease-out",
	},
	copied: {
		opacity: 1,
	},
	screenReaderOnly: {
		position: "absolute",
		width: "1px",
		height: "1px",
		margin: "-1px",
		padding: 0,
		overflow: "hidden",
		clip: "rect(0, 0, 0, 0)",
		whiteSpace: "nowrap",
		borderWidth: 0,
	},
	glyph: {
		position: "relative",
		display: "inline-flex",
		width: "16px",
		height: "16px",
	},
	symbol: {
		position: "absolute",
		inset: 0,
		width: "100%",
		height: "100%",
		transformOrigin: "center",
	},
	path: {
		transformOrigin: "center",
		transitionProperty: "opacity, transform, filter",
		transitionDuration: times.glyph,
		transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
	},
	visiblePath: {
		opacity: 1,
		transform: "scale(1)",
		filter: "blur(0)",
	},
	hiddenPath: {
		opacity: 0,
		transform: "scale(0.55)",
		filter: "blur(4px)",
	},
});

export function CopyButton({ text, sx }: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		if (copied) return;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const textarea = document.createElement("textarea");
			textarea.value = text;
			textarea.className = stylex.props(baseStyles.element, styles.clipboard).className ?? "";
			document.body.append(textarea);
			textarea.select();
			document.execCommand("copy");
			textarea.remove();
		}
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1500);
	}

	return (
		<button
			{...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, baseStyles.button, styles.button, copied && styles.copied, sx)}
			type="button"
			onClick={copy}
			aria-label="Copy to clipboard"
		>
			<span
				{...stylex.props(baseStyles.element, styles.screenReaderOnly)}
				role="status"
				aria-live="polite"
			>
				{copied ? "Copied to clipboard" : ""}
			</span>
			<span {...stylex.props(baseStyles.element, styles.glyph)} aria-hidden="true">
				<svg
					{...stylex.props(baseStyles.graphic, baseStyles.element, styles.symbol)}
					viewBox="0 0 16 16"
					width="16"
					height="16"
				>
					<path
						{...stylex.props(baseStyles.element, 
							styles.path,
							copied ? styles.hiddenPath : styles.visiblePath,
						)}
						fill="currentColor"
						d={copyPath}
					/>
					<path
						{...stylex.props(baseStyles.element, 
							styles.path,
							copied ? styles.visiblePath : styles.hiddenPath,
						)}
						fill="currentColor"
						d={checkPath}
					/>
				</svg>
			</span>
		</button>
	);
}
