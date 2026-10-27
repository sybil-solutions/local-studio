import { baseStyles } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { assets } from "../domain/asset";
import {
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { LazyMotion, domAnimation, useReducedMotion } from "motion/react";
import { animate } from "motion";
import { motion } from "../domain/motion";
import { styles } from "../styles/sections-styles";
import { site } from "../domain/site";

type PhoneFeature = {
	readonly title: string;
	readonly text: string;
	readonly image: string;
	readonly image2x: string;
	readonly alt: string;
};

const features = [
	{
		title: "Pair from Settings → Connections",
		text: `${site.products.localStudio.name} is a ${site.upstream.name} server. Pair the ${site.upstream.name} mobile app or any mobile browser over your LAN or Tailscale.`,
		image: assets.phone01,
		image2x: assets.phone01_2x,
		alt: "Local Studio threads listed in a phone browser.",
	},
	{
		title: "Follow a running turn",
		text: "Start a turn at your desk and watch reasoning, tool calls and changes stream to your phone.",
		image: assets.phone02,
		image2x: assets.phone02_2x,
		alt: "A Local Studio thread streaming on a phone.",
	},
	{
		title: "Continue from anywhere",
		text: "Send the follow-up from your phone. The agent keeps running on your machine, with your models.",
		image: assets.phone03,
		image2x: assets.phone03_2x,
		alt: "Composing a follow-up message in Local Studio on a phone.",
	},
	{
		title: "Pick the model",
		text: "Switch between agents and the local models your controllers serve, right from the composer.",
		image: assets.phone04,
		image2x: assets.phone04_2x,
		alt: "The Local Studio model picker on a phone.",
	},
] as const satisfies readonly PhoneFeature[];

const FeatureCard = memo(function FeatureCard({
	feature,
	index,
	active,
	onActivate,
	onRequestVisible,
}: {
	feature: PhoneFeature;
	index: number;
	active: boolean;
	onActivate: (index: number | null) => void;
	onRequestVisible: (index: number, center?: boolean) => void;
}) {
	return (
		<article
			{...stylex.props(baseStyles.element, styles.phoneFeature)}
			data-phone-feature=""
			data-active={active ? "true" : "false"}
			onMouseEnter={() => onActivate(index)}
			onMouseLeave={() => onActivate(null)}
		>
			<div
				{...stylex.props(baseStyles.element, baseStyles.focusable, styles.phoneFeatureMedia)}
				data-phone-feature-media=""
				data-phone-drag-interactive=""
				role="region"
				tabIndex={0}
				aria-label={`Show ${feature.title}`}
				onKeyDown={(event) => {
					if (event.key !== "Enter" && event.key !== " ") return;
					event.preventDefault();
					onRequestVisible(index, true);
				}}
				onClick={() => onRequestVisible(index, true)}
			>
				<img
					{...stylex.props(baseStyles.element, baseStyles.image, styles.phoneFeatureImage)}
					src={feature.image}
					srcSet={`${feature.image} 660w, ${feature.image2x} 1320w`}
					sizes="(max-width: 900px) min(620px, calc(100vw - 48px)), 620px"
					alt={feature.alt}
					width="1320"
					height="1320"
					loading="lazy"
					fetchPriority="low"
					decoding="async"
					draggable={false}
				/>
			</div>
			<div
				{...stylex.props(baseStyles.element, styles.phoneFeatureBody)}
				data-phone-drag-interactive=""
			>
				<span data-phone-feature-trigger {...stylex.props(baseStyles.element, styles.phoneFeatureTrigger)}>{feature.title}</span>
				<div
					data-phone-feature-description
					{...stylex.props(baseStyles.element, styles.phoneFeatureDescription)}
				>
					<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.phoneFeatureDescriptionText)}>{feature.text}</p>
				</div>
			</div>
		</article>
	);
});

function measureCarousel(carousel: HTMLDivElement) {
	const card = carousel.querySelector<HTMLElement>("[data-phone-feature]");
	const grid = carousel.querySelector<HTMLElement>("[data-phone-items]");
	if (!card || !grid) return null;
	const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
	const stride = card.getBoundingClientRect().width + gap;
	const cards = Array.from(
		grid.querySelectorAll<HTMLElement>("[data-phone-feature]"),
	);
	const maxScroll = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
	const targets = cards.map((_, index) =>
		index === cards.length - 1
			? maxScroll
			: Math.min(index * stride, maxScroll),
	);
	const carouselBounds = carousel.getBoundingClientRect();
	const centerTargets = cards.map((item) => {
		const itemBounds = item.getBoundingClientRect();
		return Math.min(
			Math.max(
				carousel.scrollLeft + itemBounds.left + itemBounds.width / 2 -
					(carouselBounds.left + carouselBounds.width / 2),
				0,
			),
			maxScroll,
		);
	});
	return {
		centerTargets,
		stride,
		targets,
	};
}

function nearestTargetIndex(targets: readonly number[], position: number) {
	let nearestIndex = 0;
	for (let index = 1; index < targets.length; index += 1) {
		if (
			Math.abs((targets[index] ?? 0) - position) <=
			Math.abs((targets[nearestIndex] ?? 0) - position)
		) {
			nearestIndex = index;
		}
	}
	return nearestIndex;
}

function isolateCarouselDrag(carousel: HTMLDivElement, dragging: boolean, origin: HTMLElement | null = null) {
	if (dragging) window.getSelection()?.removeAllRanges();
	carousel.querySelectorAll<HTMLElement>("[data-phone-drag-interactive]").forEach((element) => {
		element.inert = dragging && element !== origin;
	});
	if (dragging && document.activeElement instanceof HTMLElement && document.activeElement !== origin) {
		document.activeElement.blur();
	}
}

export function Phone() {
	const [active, setActive] = useState<number | null>(null);
	const [dragging, setDragging] = useState(false);
	const [carouselIndex, setCarouselIndex] = useState(0);
	const carouselRef = useRef<HTMLDivElement>(null);
	const carouselAnimation = useRef<{ stop: () => void } | null>(null);
	const dragOrigin = useRef<HTMLElement | null>(null);
	const dragState = useRef({
		pointerId: -1,
		startX: 0,
		startScroll: 0,
		moved: false,
	});
	const reducedMotion = useReducedMotion();

	const animateToIndex = useCallback(
		(index: number, center = false) => {
			const carousel = carouselRef.current;
			if (!carousel) return;
			const metrics = measureCarousel(carousel);
			if (!metrics) return;
			const bounded = Math.min(Math.max(index, 0), metrics.targets.length - 1);
			const target = center
				? (metrics.centerTargets[bounded] ?? 0)
				: (metrics.targets[bounded] ?? 0);
			carouselAnimation.current?.stop();
			if (reducedMotion || document.hidden) {
				carousel.scrollLeft = target;
				return;
			}
			carouselAnimation.current = animate(carousel.scrollLeft, target, {
				...motion.featureSwap,
				onUpdate: (value) => {
					carousel.scrollLeft = value;
				},
			});
		},
		[reducedMotion],
	);

	const syncFromScroll = useCallback((carousel: HTMLDivElement) => {
		const metrics = measureCarousel(carousel);
		if (!metrics) return;
		setCarouselIndex(nearestTargetIndex(metrics.targets, carousel.scrollLeft));
	}, []);

	useLayoutEffect(() => {
		const carousel = carouselRef.current;
		if (!carousel) return;
		const syncCarousel = () => syncFromScroll(carousel);
		syncCarousel();
		const observer = new ResizeObserver(syncCarousel);
		observer.observe(carousel);
		const card = carousel.querySelector<HTMLElement>("[data-phone-feature]");
		if (card) observer.observe(card);
		return () => observer.disconnect();
	}, [syncFromScroll]);

	useEffect(
		() => () => {
			carouselAnimation.current?.stop();
		},
		[],
	);

	const highlightCard = useCallback((index: number | null) => {
		setActive(index);
	}, []);

	function jumpToCarousel(index: number) {
		setCarouselIndex(index);
		animateToIndex(index);
	}

	return (
		<LazyMotion features={domAnimation} strict>
			<section
				id="mobile"
				{...stylex.props(baseStyles.element, baseStyles.sectionAnchor, styles.phone)}
				aria-labelledby="phone-title"
			>
				<div data-phone-intro {...stylex.props(baseStyles.element, styles.sectionWidth, styles.phoneIntro)}>
					<h2 id="phone-title" {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo, styles.phoneHeading)}>
						Your Session, on Your Phone
					</h2>
				</div>
				<div
					ref={carouselRef}
					{...stylex.props(baseStyles.element, baseStyles.focusable, styles.phoneCarousel, dragging && styles.phoneCarouselDragging)}
					data-carousel-index={carouselIndex}
					role="region"
					aria-label="Phone features"
					tabIndex={0}
					onKeyDown={(event) => {
						if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
						event.preventDefault();
						jumpToCarousel(carouselIndex + (event.key === "ArrowRight" ? 1 : -1));
					}}
					onScroll={(event) => syncFromScroll(event.currentTarget)}
					onClickCapture={(event) => {
						if (dragState.current.moved) {
							event.preventDefault();
							event.stopPropagation();
							dragState.current.moved = false;
							return;
						}
						const eventTarget = event.target instanceof Element ? event.target : null;
						const pointTarget = document.elementFromPoint(event.clientX, event.clientY);
						const media =
							eventTarget?.closest<HTMLElement>("[data-phone-feature-media]") ??
							pointTarget?.closest<HTMLElement>("[data-phone-feature-media]");
						const card = media?.closest<HTMLElement>("[data-phone-feature]");
						if (!card) return;
						const cards = Array.from(
							event.currentTarget.querySelectorAll<HTMLElement>("[data-phone-feature]"),
						);
						const index = cards.indexOf(card);
						if (index < 0) return;
						event.stopPropagation();
						animateToIndex(index, true);
					}}
					onPointerDown={(event) => {
						if (!event.isPrimary) return;
						if (event.pointerType === "mouse" && event.button !== 0) return;
						dragState.current.moved = false;
						carouselAnimation.current?.stop();
						dragOrigin.current =
							event.target instanceof HTMLElement
								? event.target.closest<HTMLElement>("[data-phone-drag-interactive]")
								: null;
						dragState.current = {
							pointerId: event.pointerId,
							startX: event.clientX,
							startScroll: event.currentTarget.scrollLeft,
							moved: false,
						};
						event.currentTarget.setPointerCapture(event.pointerId);
					}}
					onPointerMove={(event) => {
						if (dragState.current.pointerId !== event.pointerId) return;
						const delta = event.clientX - dragState.current.startX;
						if (Math.abs(delta) > 6 && !dragState.current.moved) {
							dragState.current.moved = true;
							isolateCarouselDrag(
								event.currentTarget,
								true,
								dragOrigin.current,
							);
							setDragging(true);
							highlightCard(null);
						}
						event.currentTarget.scrollLeft =
							dragState.current.startScroll - delta;
					}}
					onPointerUp={(event) => {
						if (dragState.current.pointerId !== event.pointerId) return;
						const { moved, startX } = dragState.current;
						dragState.current.pointerId = -1;
						isolateCarouselDrag(event.currentTarget, false);
						setDragging(false);
						event.currentTarget.releasePointerCapture(event.pointerId);
						const metrics = measureCarousel(event.currentTarget);
						if (!metrics) return;
						let nextIndex = nearestTargetIndex(
							metrics.targets,
							event.currentTarget.scrollLeft,
						);
						const direction = Math.sign(startX - event.clientX);
						if (moved && direction > 0) {
							const forwardIndex = metrics.targets.findIndex(
								(target) => target >= event.currentTarget.scrollLeft,
							);
							nextIndex =
								forwardIndex === -1 ? metrics.targets.length - 1 : forwardIndex;
						} else if (moved && direction < 0) {
							for (let index = metrics.targets.length - 1; index >= 0; index -= 1) {
								if ((metrics.targets[index] ?? 0) <= event.currentTarget.scrollLeft) {
									nextIndex = index;
									break;
								}
							}
						}
						animateToIndex(nextIndex);
					}}
					onPointerCancel={(event) => {
						if (dragState.current.pointerId !== event.pointerId) return;
						dragState.current.pointerId = -1;
						dragState.current.moved = false;
						isolateCarouselDrag(event.currentTarget, false);
						setDragging(false);
						const metrics = measureCarousel(event.currentTarget);
						if (!metrics) return;
						animateToIndex(
							nearestTargetIndex(metrics.targets, event.currentTarget.scrollLeft),
						);
					}}
					onLostPointerCapture={(event) => {
						dragState.current.pointerId = -1;
						isolateCarouselDrag(event.currentTarget, false);
						setDragging(false);
					}}
				>
					<div {...stylex.props(baseStyles.element, styles.phoneItems)} data-phone-items="">
						{features.map((feature, index) => (
							<FeatureCard
								feature={feature}
								index={index}
								active={active === index}
								onActivate={highlightCard}
								onRequestVisible={animateToIndex}
								key={feature.title}
							/>
						))}
					</div>
				</div>
			</section>
		</LazyMotion>
	);
}
