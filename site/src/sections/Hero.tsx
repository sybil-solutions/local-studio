import { baseStyles } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { assets } from "../domain/asset";
import { useEffect, useRef } from "react";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { machinePath, setupPath } from "../domain/route";
import { CtaPair } from "../components/Links";
import { motion } from "../domain/motion";
import { LocalLink } from "../components/LocalLink";
import { LocalAiLogo } from "../logo/LocalAiLogo";
import { site } from "../domain/site";
import { release } from "../domain/release";
import { styles } from "../styles/sections-styles";
const settle = { opacity: 1, y: 0, filter: "blur(0px)" };
export function Hero() {
	const reduceMotion = useReducedMotion();
	const video = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		if (reduceMotion) video.current?.pause();
	}, [reduceMotion]);
	const enter = (delay: number) => ({
		initial: reduceMotion ? false : { opacity: 0, y: 12, filter: "blur(6px)" },
		animate: settle,
		transition: { ...motion.heroEnter, delay },
	});
	return (
		<LazyMotion features={domAnimation} strict>
			<section
				{...stylex.props(baseStyles.element, stylex.defaultMarker(), styles.hero)}
				id="top"
				aria-labelledby="landing-title"
			>
				<LocalAiLogo />
				<div {...stylex.props(baseStyles.element, styles.heroInner)}>
					<div data-hero-copy {...stylex.props(baseStyles.element, styles.heroCopy)}>
						<m.div {...stylex.props(baseStyles.element)} {...enter(0.12)}>
							<h1
								id="landing-title"
								tabIndex={-1}
								{...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.focusable, styles.heroHeading)}
							>
								Intelligence Should Be{" "}
								<span {...stylex.props(baseStyles.element, styles.heroTitleEnd)}>
									Owned
									<LocalLink
										sx={styles.heroMarkButton}
										href={machinePath}
										aria-label="Machine-readable page"
									>
										<img
										{...stylex.props(baseStyles.element, baseStyles.image, styles.heroMark)}
										src={assets.mark}
										alt=""
										width="525"
										height="525"
										aria-hidden="true"
										draggable={false}
									/>
									</LocalLink>
								</span>
							</h1>
						</m.div>
						<m.div {...stylex.props(baseStyles.element)} {...enter(0.2)}>
							<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.heroThesis)}>
								Every coding agent, on your own models, on every machine you own.
							</p>
							<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.heroCredit)}>
								{site.products.localStudio.name} {release.major} is built on{" "}
								<a
									{...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, styles.heroCreditLink)}
									href={site.upstream.repository}
									target="_blank"
									rel="noreferrer"
								>
									{site.upstream.name}
								</a>{" "}
								by {site.upstream.authors} ({site.upstream.license}).
							</p>
						</m.div>
						<m.div {...stylex.props(baseStyles.element, styles.heroActions)} {...enter(0.28)}>
							<CtaPair secondary={{ href: setupPath, label: "Setup Prompt" }} />
						</m.div>
					</div>
				</div>
				<m.div
					{...stylex.props(baseStyles.element, 
					baseStyles.sectionAnchor,
					styles.sectionWidth,
					styles.heroStage,
				)}
					id="product"
					{...enter(0.75)}
				>
					<video
						ref={video}
						{...stylex.props(baseStyles.element, styles.heroVideo)}
						src={assets.launchVideo}
						poster={assets.launchPoster}
						width="1920"
						height="1080"
						aria-label={`${site.products.localStudio.name} ${release.major} one-minute tour`}
						autoPlay
						muted
						loop
						playsInline
						controls
						preload="metadata"
					/>
				</m.div>
			</section>
		</LazyMotion>
	);
}
