import * as stylex from "@stylexjs/stylex";
import { colors, constants, lengths, times } from "./public-tokens.stylex";

const reducedMotion = "@media (prefers-reduced-motion: reduce)";
const desktopNavHeight = `max(${lengths.navHeight}, calc(env(safe-area-inset-top, 0px) + 40px))`;
const mobileNavHeight = `max(${lengths.navHeight}, calc(env(safe-area-inset-top, 0px) + 44px))`;
const storyDemoEnter = stylex.keyframes({
	from: {
		opacity: 0,
		transform: "translateY(6px)",
	},
	to: {
		opacity: 1,
		transform: "translateY(0)",
	},
});

const pageWidth = `min(${lengths.pageWidth}, calc(100% - ${lengths.pageGutter}))`;
const scrimAmbient = `color-mix(in oklab, ${colors.background} 48%, transparent)`;
const scrimDirect = `color-mix(in oklab, ${colors.background} 32%, transparent)`;
const phoneCarouselGutter = `max(24px, calc((100vw - ${lengths.pageWidth}) / 2))`;
const phoneCardWidth = "min(620px, calc(100vw - 48px))";

export const styles = stylex.create({
	sectionWidth: {
		width: pageWidth,
		marginInline: "auto",
	},
	hero: {
		position: "relative",
		backgroundColor: colors.background,
		overflowX: "clip",
		overflowY: "visible",
		isolation: "isolate",
		paddingBottom: {
			default: "40px",
			"@media (max-width: 900px)": "28px",
		},
	},
	heroInner: {
		position: "relative",
		zIndex: 2,
		display: "flex",
		width: pageWidth,
		minHeight: 0,
		flexDirection: {
			default: "row",
			"@media (max-width: 620px)": "column",
		},
		alignItems: "flex-start",
		justifyContent: "center",
		marginInline: "auto",
		paddingTop: {
			default: "clamp(140px, 18svh, 208px)",
			"@media (max-width: 900px)": "76px",
		},
		textAlign: "center",
	},
	heroCopy: {
		position: { default: "relative", "::before": "absolute" },
		zIndex: { default: 2, "::before": -1 },
		maxWidth: "790px",
		content: { default: null, "::before": '""' },
		inset: { default: null, "::before": "-18% -22%" },
		backgroundImage: {
			default: null,
			"::before": `radial-gradient(ellipse 68% 62% at 50% 44%, ${scrimAmbient}, transparent 72%), radial-gradient(ellipse 44% 46% at 50% 40%, ${scrimDirect}, transparent 70%)`,
		},
		pointerEvents: { default: null, "::before": "none" },
	},
	heroHeading: {
		marginTop: 0,
		fontFamily: constants.fontSans,
		fontSize: {
			default: "70px",
			"@media (max-width: 620px)": "40px",
		},
		fontWeight: 400,
		lineHeight: {
			default: "78px",
			"@media (max-width: 620px)": "44px",
		},
		letterSpacing: constants.heroTracking,
		textWrap: "balance",
	},
	heroTitleEnd: {
		whiteSpace: "nowrap",
	},
	heroMarkButton: {
		display: "inline-flex",
		width: { default: "0.78em", "@media (max-width: 620px)": "44px" },
		height: { default: "0.78em", "@media (max-width: 620px)": "44px" },
		minWidth: 0,
		minHeight: 0,
		marginTop: 0,
		marginRight: 0,
		marginBottom: 0,
		marginLeft: "0.14em",
		padding: 0,
		borderWidth: 0,
		verticalAlign: "-0.06em",
		backgroundColor: "transparent",
		cursor: "pointer",
	},
	heroMark: {
		display: "block",
		width: "100%",
		height: "100%",
		filter: {
			default: "none",
			"@media (prefers-color-scheme: light)": "invert(1)",
		},
	},
	heroThesis: {
		marginTop: "12px",
		color: colors.foreground,
		fontFamily: constants.fontSans,
		fontSize: "16px",
		fontWeight: 400,
		lineHeight: "24px",
	},
	heroCredit: {
		marginTop: "8px",
		color: colors.chrome,
		fontFamily: constants.fontSans,
		fontSize: "14px",
		fontWeight: 400,
		lineHeight: "20px",
	},
	heroCreditLink: {
		color: {
			default: colors.dim,
			"@media (hover: hover)": {
				default: colors.dim,
				":hover": colors.foreground,
			},
		},
		textDecoration: "underline",
		textUnderlineOffset: "3px",
	},
	heroActions: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		columnGap: "12px",
		rowGap: "12px",
		marginTop: "36px",
	},
	heroStage: {
		position: "relative",
		zIndex: 4,
		marginTop: {
			default: "72px",
			"@media (max-width: 900px)": "56px",
		},
	},
	heroVideo: {
		display: "block",
		width: "100%",
		height: "auto",
		aspectRatio: "16 / 9",
		borderWidth: "1px",
		borderStyle: "solid",
		borderColor: colors.border,
		borderRadius: lengths.radiusMediaFrame,
		backgroundColor: colors.background,
		boxShadow: `0 0 0 7px ${colors.mediaRingInner}, 0 0 0 8px ${colors.mediaRingOuter}, 0 28px 80px ${colors.shadowAmbient}, 0 8px 24px ${colors.shadowDirect}`,
	},
	sponsors: {
		marginTop: "96px",
	},
	sponsorsTitle: {
		marginTop: 0,
		marginRight: 0,
		marginBottom: "36px",
		marginLeft: 0,
		fontFamily: constants.fontSans,
		fontSize: "16px",
		fontWeight: 400,
		lineHeight: "24px",
		color: colors.dim,
		textAlign: "left",
	},
	sponsorsList: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "center",
		justifyContent: {
			default: "space-between",
			"@media (max-width: 900px)": "center",
		},
		columnGap: "48px",
		rowGap: "24px",
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	sponsorImage: {
		display: "block",
		width: "auto",
		filter: {
			default: "none",
			"@media (prefers-color-scheme: light)": "invert(1)",
		},
	},
	sponsorImageSize: (width: number, height: number) => ({
		width,
		height,
	}),
	story: {
		paddingTop: lengths.storyGap,
		paddingRight: 0,
		paddingBottom: 0,
		paddingLeft: 0,
		overflowX: {
			default: "visible",
			"@media (max-width: 900px)": "clip",
		},
	},
	storyShowcase: {
		position: "relative",
	},
	storySticky: {
		position: "sticky",
		zIndex: 1,
		top: {
			default: desktopNavHeight,
			"@media (max-width: 900px)": mobileNavHeight,
		},
		display: "grid",
		gridTemplateColumns: {
			default: "minmax(280px, 0.58fr) minmax(0, 1.42fr)",
			"@media (max-width: 900px)": "minmax(0, 1fr)",
		},
		alignItems: "center",
		alignContent: {
			default: "normal",
			"@media (max-width: 900px)": "center",
		},
		height: {
			default: `calc(100svh - ${desktopNavHeight})`,
			"@media (max-width: 900px)": `calc(100svh - ${mobileNavHeight})`,
		},
		columnGap: {
			default: "clamp(40px, 5vw, 80px)",
			"@media (max-width: 900px)": "24px",
		},
		rowGap: {
			default: "clamp(40px, 5vw, 80px)",
			"@media (max-width: 900px)": "24px",
		},
		paddingBlock: {
			default: "clamp(24px, 5svh, 48px)",
			"@media (max-width: 900px)": "20px",
		},
	},
	storyOptionsWindow: {
		alignSelf: "center",
		width: "100%",
		height: {
			default: `min(787px, calc(100svh - ${desktopNavHeight} - 48px))`,
			"@media (max-width: 900px)": "auto",
		},
		minHeight: 0,
		overflow: "visible",
	},
	storyOptions: {
		display: {
			default: "grid",
			"@media (max-width: 900px)": "block",
		},
		gridTemplateRows: "repeat(5, minmax(0, 1fr))",
		width: "100%",
		height: {
			default: "100%",
			"@media (max-width: 900px)": "auto",
		},
		margin: 0,
		padding: 0,
		listStyle: "none",
		transitionProperty: "transform",
		transitionDuration: times.feature,
		transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
	},
	storyOptionsOffset: (offset: string) => ({
		transform: {
			default: `translateY(${offset})`,
			"@media (max-width: 900px)": "none",
		},
	}),
	storyOption: {
		position: "relative",
		display: {
			default: "flex",
			"@media (max-width: 900px)": "none",
		},
		flexDirection: "column",
		justifyContent: "center",
		minHeight: 0,
		paddingTop: 0,
		paddingRight: {
			default: "14px",
			"@media (max-width: 900px)": 0,
		},
		paddingBottom: 0,
		paddingLeft: {
			default: "14px",
			"@media (max-width: 900px)": 0,
		},
		borderTopWidth: {
			default: "1px",
			"@media (max-width: 900px)": 0,
		},
		borderTopStyle: "solid",
		borderTopColor: colors.borderSoft,
	},
	storyFirstOption: {
		borderTopWidth: 0,
	},
	storySelectedOption: {
		display: "flex",
	},
	storyOptionControl: {
		display: "grid",
		width: "100%",
		minHeight: 0,
		gridTemplateColumns: "1fr",
		alignItems: "baseline",
		padding: 0,
		color: colors.quiet,
		textAlign: "left",
	},
	storyOptionTitle: {
		color: colors.quiet,
		fontFamily: constants.fontSans,
		fontSize: "28px",
		fontWeight: 425,
		lineHeight: "36px",
		transitionProperty: "color",
		transitionDuration: times.fast,
		transitionTimingFunction: "ease-out",
	},
	storySelectedOptionTitle: {
		color: colors.foreground,
	},
	storyDescriptionMotion: {
		opacity: 0,
		transform: "translateY(6px)",
		filter: "blur(8px)",
		transitionProperty: "opacity, transform, filter",
		transitionDuration: times.feature,
		transitionTimingFunction:
			"cubic-bezier(0.16, 1, 0.3, 1), cubic-bezier(0.16, 1, 0.3, 1), cubic-bezier(0.16, 1, 0.3, 1)",
	},
	storyDescription: {
		maxWidth: "440px",
		marginTop: "8px",
		marginRight: 0,
		marginBottom: 0,
		marginLeft: 0,
		color: colors.fine,
		fontFamily: constants.fontSans,
		fontSize: "16px",
		fontWeight: 400,
		lineHeight: "24px",
	},
	storySelectedDescription: {
		opacity: 1,
		transform: "translateY(0)",
		filter: "blur(0)",
	},
	storyVisualHome: {
		alignSelf: "center",
		width: {
			default: "auto",
			"@media (max-width: 900px)": "100%",
		},
		maxHeight: {
			default: `min(787px, calc(100svh - ${desktopNavHeight} - 48px))`,
			"@media (max-width: 900px)": "none",
		},
		minHeight: 0,
		minWidth: 0,
		maxWidth: "100%",
		overflow: "clip",
	},
	storyVisual: {
		position: "relative",
		width: "100%",
		minWidth: 0,
		maxWidth: "100%",
		margin: 0,
		overflow: "clip",
	},
	storyDemoTransition: {
		contain: "paint",
		willChange: "opacity, transform",
		animationName: {
			default: storyDemoEnter,
			[reducedMotion]: "none",
		},
		animationDuration: times.feature,
		animationTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
		animationIterationCount: {
			default: 1,
			[reducedMotion]: 1,
		},
		animationFillMode: "both",
	},
	storyImage: {
		display: "block",
		width: "100%",
		height: "auto",
		borderWidth: "1px",
		borderStyle: "solid",
		borderColor: colors.border,
		borderRadius: lengths.radiusFrame,
	},
	storyScrollTrack: (height: string) => ({
		position: "relative",
		zIndex: 0,
		marginTop: {
			default: `calc(${desktopNavHeight} - 100svh)`,
			"@media (max-width: 900px)": `calc(${mobileNavHeight} - 100svh)`,
		},
		pointerEvents: "none",
		height,
	}),
	screenReaderOnly: {
		position: "absolute",
		width: "1px",
		height: "1px",
		padding: 0,
		margin: "-1px",
		overflow: "hidden",
		clip: "rect(0, 0, 0, 0)",
		whiteSpace: "nowrap",
		borderWidth: 0,
	},
	phone: {
		paddingTop: lengths.storyGap,
		paddingRight: 0,
		paddingBottom: 0,
		paddingLeft: 0,
	},
	phoneIntro: {
		textAlign: "left",
	},
	phoneHeading: {
		maxWidth: "760px",
		marginTop: 0,
		fontFamily: constants.fontSans,
		fontSize: {
			default: "56px",
			"@media (max-width: 620px)": "32px",
		},
		fontWeight: 425,
		lineHeight: {
			default: "60px",
			"@media (max-width: 620px)": "40px",
		},
		letterSpacing: constants.headerTracking,
	},
	phoneCarousel: {
		width: "100%",
		overflowX: "auto",
		marginTop: "32px",
		cursor: {
			default: "grab",
			":active": "grabbing",
		},
		overscrollBehaviorX: "contain",
		scrollbarWidth: "none",
		touchAction: "pan-y",
		"::-webkit-scrollbar": {
			display: "none",
		},
	},
	phoneCarouselDragging: {
		userSelect: "none",
	},
	phoneItems: {
		display: "flex",
		width: "max-content",
		alignItems: "flex-start",
		columnGap: "24px",
		rowGap: "24px",
		paddingInline: phoneCarouselGutter,
	},
	phoneFeature: {
		minWidth: 0,
		flexGrow: 0,
		flexShrink: 0,
		flexBasis: phoneCardWidth,
	},
	phoneFeatureBody: {
		minHeight: "56px",
		paddingTop: "16px",
		paddingRight: 0,
		paddingBottom: "16px",
		paddingLeft: 0,
	},
	phoneFeatureTrigger: {
		display: "block",
		minWidth: 0,
		flexGrow: 1,
		padding: 0,
		borderWidth: 0,
		backgroundColor: "transparent",
		color: colors.foreground,
		fontFamily: constants.fontSans,
		fontSize: "16px",
		fontWeight: 500,
		lineHeight: "24px",
		textAlign: "left",
	},
	phoneFeatureDescription: {
		overflow: "hidden",
	},
	phoneFeatureDescriptionText: {
		maxWidth: "42ch",
		paddingTop: "12px",
		color: colors.fine,
		fontFamily: constants.fontSans,
		fontSize: "16px",
		fontWeight: 400,
		lineHeight: "24px",
	},
	phoneFeatureMedia: {
		position: "relative",
		isolation: "isolate",
		aspectRatio: "1",
		overflow: "hidden",
		padding: "1px",
		borderRadius: lengths.radiusFrame,
		backgroundImage: {
			default: `linear-gradient(to bottom, ${colors.borderStrong}, ${colors.borderSoft})`,
			":focus-visible": `linear-gradient(to bottom, ${colors.borderStrongHover}, ${colors.border})`,
		},
		"::after": {
			content: '""',
			position: "absolute",
			zIndex: 1,
			inset: "1px",
			borderRadius: `calc(${lengths.radiusFrame} - 1px)`,
			pointerEvents: "none",
			backgroundColor: colors.surfaceFaint,
			mixBlendMode: {
				default: "screen",
				"@media (prefers-color-scheme: light)": "multiply",
			},
		},
	},
	phoneFeatureImage: {
		display: "block",
		width: "100%",
		height: "100%",
		borderRadius: `calc(${lengths.radiusFrame} - 1px)`,
		objectFit: "cover",
		filter: "saturate(1.08) contrast(1.02)",
	},
});
