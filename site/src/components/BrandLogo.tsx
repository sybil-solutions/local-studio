import { baseStyles, type PublicStyle } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { assets } from "../domain/asset";

const styles = stylex.create({
	logo: {
		display: "block",
		width: "28px",
		height: "28px",
		filter: {
			default: "none",
			"@media (prefers-color-scheme: light)": "invert(1)",
		},
	},
});

export function BrandLogo({ sx }: { sx?: PublicStyle }) {
	return (
		<img
			{...stylex.props(baseStyles.element, baseStyles.image, styles.logo, sx)}
			src={assets.brandLogo}
			alt=""
			width="525"
			height="525"
			draggable={false}
		/>
	);
}
