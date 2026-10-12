import * as stylex from "@stylexjs/stylex";
import { colors, constants } from "./public-tokens.stylex";

const coarsePointer = "@media (hover: none) and (pointer: coarse)";
const reducedMotion = "@media (prefers-reduced-motion: reduce)";

export type PublicStyle = stylex.StyleXArray<
	false | null | undefined | stylex.CompiledStyles
>;

export const selectionStyles = stylex.create({
	brightToDay: {
		backgroundColor: {
			default: null,
			"::selection":
				`color-mix(in srgb, ${colors.selectionSkyBright}, ${colors.selectionSkyDay} attr(data-selection-mix type(<percentage>)))`,
		},
	},
	dayToBlue: {
		backgroundColor: {
			default: null,
			"::selection":
				`color-mix(in srgb, ${colors.selectionSkyDay}, ${colors.selectionSkyBlue} attr(data-selection-mix type(<percentage>)))`,
		},
	},
	blueToDusk: {
		backgroundColor: {
			default: null,
			"::selection":
				`color-mix(in srgb, ${colors.selectionSkyBlue}, ${colors.selectionSkyDusk} attr(data-selection-mix type(<percentage>)))`,
		},
	},
	duskToNight: {
		backgroundColor: {
			default: null,
			"::selection":
				`color-mix(in srgb, ${colors.selectionSkyDusk}, ${colors.selectionSkyNight} attr(data-selection-mix type(<percentage>)))`,
		},
	},
	night: {
		backgroundColor: {
			default: null,
			"::selection": colors.selectionSkyNight,
		},
	},
	darkInk: {
		color: { default: null, "::selection": colors.selectionInk },
	},
});

export const baseStyles = stylex.create({
	element: {
		boxSizing: "border-box",
		"::before": {
			boxSizing: "border-box",
		},
		"::after": {
			boxSizing: "border-box",
		},
	},
	paragraph: {
		marginBlock: 0,
		textWrap: "pretty",
	},
	heading: {
		marginBlock: 0,
		textWrap: "balance",
	},
	headingOne: {
		fontFamily: constants.fontSans,
		fontSize: {
			default: "56px",
			"@media (max-width: 620px)": "40px",
		},
		fontWeight: 425,
		lineHeight: {
			default: "60px",
			"@media (max-width: 620px)": "44px",
		},
		letterSpacing: constants.headerTracking,
	},
	headingTwo: {
		fontFamily: constants.fontSans,
		fontSize: {
			default: "28px",
			"@media (max-width: 620px)": "24px",
		},
		fontWeight: 425,
		lineHeight: {
			default: "36px",
			"@media (max-width: 620px)": "32px",
		},
		letterSpacing: 0,
	},
	headingThree: {
		fontFamily: constants.fontSans,
		fontSize: "19px",
		fontWeight: 425,
		lineHeight: "28px",
		letterSpacing: 0,
	},
	monospace: {
		fontFamily: constants.fontMono,
	},
	interactive: {
		color: "inherit",
		fontFamily: "inherit",
		fontSize: "inherit",
		fontStretch: "inherit",
		fontStyle: "inherit",
		fontVariant: "inherit",
		fontWeight: "inherit",
		lineHeight: "inherit",
		letterSpacing: "inherit",
		textDecoration: "inherit",
		touchAction: "manipulation",
		userSelect: "none",
		filter: {
			default: null,
			[coarsePointer]: {
				default: null,
				":active": "brightness(1.16)",
			},
		},
	},
	focusable: {
		outlineStyle: {
			default: null,
			":focus": "none",
		},
		boxShadow: {
			default: null,
			":focus": {
				default: null,
				[stylex.when.ancestor("[data-keyboard='true']")]:
					`0 0 0 2px ${colors.foreground}, 0 0 0 5px ${colors.focusHalo}`,
			},
		},
	},
	button: {
		padding: 0,
		borderWidth: 0,
		borderRadius: 0,
		backgroundColor: "transparent",
		cursor: "pointer",
	},
	list: {
		margin: 0,
		padding: 0,
		listStyleType: "none",
	},
	dialog: {
		margin: 0,
	},
	graphic: {
		display: "block",
		verticalAlign: "middle",
	},
	sectionAnchor: {
		scrollMarginTop: "112px",
	},
	image: {
		display: "block",
		maxWidth: "100%",
		height: "auto",
		verticalAlign: "middle",
		userSelect: "none",
	},
	html: {
		minWidth: "320px",
		minHeight: "100%",
		overflowX: "clip",
		scrollbarGutter: "stable",
		overflowY: {
			default: "visible",
			":is([data-nav-open='true'])": "hidden",
		},
		overscrollBehavior: {
			default: "auto",
			":is([data-nav-open='true'])": "none",
		},
		scrollBehavior: {
			default: "smooth",
			[reducedMotion]: "auto",
		},
		backgroundColor: {
			default: colors.background,
			"::selection": colors.selectionSkyBlue,
		},
		color: {
			default: colors.foreground,
			"::selection": colors.selectionInk,
		},
		colorScheme: {
			default: "dark",
			"@media (prefers-color-scheme: light)": "light",
		},
		fontFamily: constants.fontSans,
		fontSynthesis: "none",
		textRendering: "optimizeLegibility",
		WebkitFontSmoothing: "antialiased",
		MozOsxFontSmoothing: "grayscale",
		textSizeAdjust: "100%",
		WebkitTapHighlightColor: "transparent",
	},
	body: {
		minWidth: "320px",
		minHeight: "100%",
		overflow: {
			default: "visible",
			":is([data-nav-open='true'])": "hidden",
		},
		overscrollBehavior: {
			default: "auto",
			":is([data-nav-open='true'])": "none",
		},
		marginTop: 0,
		marginRight: 0,
		marginBottom: 0,
		marginLeft: 0,
		color: colors.foreground,
		backgroundColor: colors.background,
		fontFamily: constants.fontSans,
		fontSize: "16px",
		fontWeight: 400,
		lineHeight: "24px",
		letterSpacing: 0,
	},
	root: {
		isolation: "isolate",
		color: colors.foreground,
		backgroundColor: colors.background,
	},
});
