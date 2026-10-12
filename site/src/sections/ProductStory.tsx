import { baseStyles } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { productFeatures } from "../content/product";
import { frameSizes, responsiveSrcSet } from "../domain/asset";
import { renderInlineReact } from "../ui/prose";
import { site } from "../domain/site";
import { styles } from "../styles/sections-styles";
function useStoryProgress() {
	const [activeIndex, setActiveIndex] = useState(0);
	const showcaseRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const showcase = showcaseRef.current;
		const sticky = showcase?.querySelector<HTMLElement>("[data-story-sticky]");
		if (!showcase || !sticky) return;
		let updateFrame = 0;
		let measureFrame = 0;
		let showcaseTop = 0;
		let navHeight = 72;
		let scrollRange = 1;
		let scrollActive = false;
		let disposed = false;

		const update = () => {
			updateFrame = 0;
			const traveled = Math.min(
				Math.max(window.scrollY + navHeight - showcaseTop, 0),
				scrollRange,
			);
			const scenePosition = (traveled / scrollRange) * productFeatures.length;
			const nextIndex = Math.min(productFeatures.length - 1, Math.floor(scenePosition));
			setActiveIndex((current) => (current === nextIndex ? current : nextIndex));
		};

		const measure = () => {
			measureFrame = 0;
			const header = document.querySelector("header");
			navHeight = header?.getBoundingClientRect().height || 72;
			const stageHeight = Math.max(1, sticky.offsetHeight);
			scrollRange = Math.max(1, showcase.offsetHeight - stageHeight);
			showcaseTop = window.scrollY + showcase.getBoundingClientRect().top;
			if (updateFrame !== 0) window.cancelAnimationFrame(updateFrame);
			update();
		};

		const scheduleUpdate = () => {
			if (updateFrame === 0) updateFrame = window.requestAnimationFrame(update);
		};
		const scheduleMeasure = () => {
			if (measureFrame === 0) measureFrame = window.requestAnimationFrame(measure);
		};

		const setScrollActive = (active: boolean) => {
			if (scrollActive === active) return;
			scrollActive = active;
			if (active) {
				window.addEventListener("scroll", scheduleUpdate, { passive: true });
				scheduleUpdate();
			} else {
				window.removeEventListener("scroll", scheduleUpdate);
			}
		};
		const sizeObserver = new ResizeObserver(scheduleMeasure);
		const visibilityObserver = new IntersectionObserver(
			(entries) => setScrollActive(entries.at(-1)?.isIntersecting ?? false),
			{ rootMargin: "100px 0px" },
		);
		sizeObserver.observe(showcase);
		sizeObserver.observe(sticky);
		visibilityObserver.observe(showcase);
		scheduleMeasure();
		window.addEventListener("resize", scheduleMeasure);
		void document.fonts.ready.then(() => {
			if (!disposed) scheduleMeasure();
		});
		return () => {
			disposed = true;
			sizeObserver.disconnect();
			visibilityObserver.disconnect();
			window.removeEventListener("scroll", scheduleUpdate);
			window.removeEventListener("resize", scheduleMeasure);
			if (updateFrame !== 0) window.cancelAnimationFrame(updateFrame);
			if (measureFrame !== 0) window.cancelAnimationFrame(measureFrame);
		};
	}, []);

	return { activeIndex, showcaseRef };
}

export function ProductStory() {
	const { activeIndex, showcaseRef } = useStoryProgress();
	const activeFeature = productFeatures[activeIndex] ?? productFeatures[0];
	const optionsOffset = `${(1 - activeIndex) * 20}%`;
	return (
		<section id="media" {...stylex.props(baseStyles.element, baseStyles.sectionAnchor, styles.sectionWidth, styles.story)} aria-label={`${site.products.localStudio.name} product story`}>
				<div {...stylex.props(baseStyles.element, styles.storyShowcase)} ref={showcaseRef}>
					<div {...stylex.props(baseStyles.element, styles.storySticky)} data-story-sticky="">
						<div {...stylex.props(baseStyles.element, styles.storyOptionsWindow)}>
							<ol
								{...stylex.props(baseStyles.list, baseStyles.element, styles.storyOptions, styles.storyOptionsOffset(optionsOffset))}
								aria-label={`${site.products.localStudio.name} capabilities`}
								data-active-index={activeIndex}
							>
								{productFeatures.map((feature, index) => {
									const selected = activeIndex === index;
									return (
										<li
											{...stylex.props(baseStyles.element, 
											styles.storyOption,
											index === 0 && styles.storyFirstOption,
											selected && styles.storySelectedOption,
										)}
											key={feature.storyTitle}
											aria-current={selected ? "step" : undefined}
										>
											<div {...stylex.props(baseStyles.element, styles.storyOptionControl)}>
												<span
													{...stylex.props(baseStyles.element, 
													styles.storyOptionTitle,
													selected && styles.storySelectedOptionTitle,
												)}
												>
													{feature.storyTitle}
												</span>
											</div>
											<div
												{...stylex.props(
													baseStyles.element,
													styles.storyDescriptionMotion,
													selected && styles.storySelectedDescription,
												)}
												aria-hidden={!selected}
											>
												<p
													{...stylex.props(baseStyles.element, baseStyles.paragraph, styles.storyDescription)}
												>
													{renderInlineReact(feature.storyDescription)}
												</p>
											</div>
										</li>
									);
								})}
							</ol>
						</div>
						<div {...stylex.props(baseStyles.element, styles.storyVisualHome)}>
							<figure
								{...stylex.props(baseStyles.element, styles.storyVisual)}
								data-active-feature={activeFeature.storyTitle}
							>
								<img
									{...stylex.props(baseStyles.element, baseStyles.image, styles.storyDemoTransition, styles.storyImage)}
									key={activeFeature.slug}
									src={activeFeature.image}
									srcSet={responsiveSrcSet(activeFeature.image)}
									sizes={frameSizes}
									alt={activeFeature.alt}
									width="2880"
									height="2200"
									loading="lazy"
									decoding="async"
									draggable={false}
								/>
								<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.screenReaderOnly)} role="status">
									{activeFeature.storyTitle}. {renderInlineReact(activeFeature.storyDescription)}
								</p>
							</figure>
						</div>
					</div>
					<div
						{...stylex.props(baseStyles.element, 
							styles.storyScrollTrack(
								`calc(${productFeatures.length + 1} * clamp(300px, 42svh, 420px))`,
							),
						)}
						aria-hidden="true"
					/>
				</div>
		</section>
	);
}
