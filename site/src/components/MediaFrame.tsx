import { baseStyles, type PublicStyle } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { colors, constants, lengths } from "../styles/public-tokens.stylex";
import type { ImgHTMLAttributes, ReactNode } from "react";

interface MediaFrameProps
	extends Omit<ImgHTMLAttributes<HTMLImageElement>, "className"> {
	caption?: ReactNode | undefined;
	sx?: PublicStyle;
}

const styles = stylex.create({
	frame: {
		position: "relative",
		margin: 0,
		overflow: "hidden",
		padding: { default: "7px", "@media (max-width: 620px)": "5px" },
		borderWidth: '1px',
		borderStyle: 'solid',
		borderColor: colors.borderSoft,
		borderRadius: lengths.radiusMediaFrame,
		backgroundColor: colors.surfaceFaint,
		boxShadow:
			`0 0 0 7px ${colors.mediaRingInner}, 0 0 0 8px ${colors.mediaRingOuter}, 0 28px 80px ${colors.shadowAmbient}, 0 8px 24px ${colors.shadowDirect}`,
	},
	caption: {
		display: "flex",
		justifyContent: "space-between",
		paddingBlock: '12px',
		paddingInline: '14px',
		color: colors.dim,
		fontFamily: constants.fontSans,
		fontSize: "16px",
		fontWeight: 400,
		lineHeight: "24px",
	},
	image: {
		display: "block",
		width: "100%",
		height: { default: "auto", "@media (max-width: 620px)": "auto" },
		aspectRatio: { default: "auto", "@media (max-width: 620px)": "4 / 3" },
		objectFit: { default: "fill", "@media (max-width: 620px)": "cover" },
		objectPosition: "center",
		borderWidth: '1px',
		borderStyle: 'solid',
		borderColor: colors.border,
		borderRadius: lengths.radiusControl,
	},
});

export function MediaFrame({ caption, sx, ...image }: MediaFrameProps) {
	return (
		<figure {...stylex.props(baseStyles.element, styles.frame, sx)}>
			{caption ? (
				<figcaption {...stylex.props(baseStyles.element, styles.caption)}>{caption}</figcaption>
			) : null}
			<img {...stylex.props(baseStyles.element, baseStyles.image, styles.image)} {...image} draggable={false} />
		</figure>
	);
}
