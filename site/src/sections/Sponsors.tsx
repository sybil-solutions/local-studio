import { baseStyles } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { assets } from "../domain/asset";
import { site } from "../domain/site";
import { styles } from "../styles/sections-styles";
const SPONSORS = [
	{ name: "NVIDIA", src: assets.sponsorNvidia, width: 112, height: 21 },
	{ name: "Factory", src: assets.sponsorFactory, width: 140, height: 21 },
	{ name: "Lambda", src: assets.sponsorLambda, width: 98, height: 21 },
	{
		name: "Prime Intellect",
		src: assets.sponsorPrime,
		width: 162,
		height: 27,
	},
	{
		name: "TNG Technology Consulting",
		src: assets.sponsorTng,
		width: 143,
		height: 21,
	},
];

export function Sponsors() {
	return (
		<section
			{...stylex.props(baseStyles.element, styles.sectionWidth, styles.sponsors)}
			aria-labelledby="sponsors-title"
		>
			<p id="sponsors-title" {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.sponsorsTitle)}>
				Supporters of {site.company.name}
			</p>
			<ul {...stylex.props(baseStyles.list, baseStyles.element, styles.sponsorsList)}>
				{SPONSORS.map(({ name, src, width, height }) => (
					<li key={name} {...stylex.props(baseStyles.element)}>
						<img
							{...stylex.props(baseStyles.element, baseStyles.image, 
								styles.sponsorImage,
								styles.sponsorImageSize(width, height),
							)}
							src={src}
							alt={name}
							draggable={false}
						/>
					</li>
				))}
			</ul>
		</section>
	);
}
