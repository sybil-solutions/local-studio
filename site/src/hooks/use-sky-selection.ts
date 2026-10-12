import * as stylex from "@stylexjs/stylex";
import { useEffect } from "react";
import { selectionStyles } from "../styles/base-styles";

const selectionStops = [
	selectionStyles.brightToDay,
	selectionStyles.dayToBlue,
	selectionStyles.blueToDusk,
	selectionStyles.duskToNight,
	selectionStyles.night,
] as const;

function selectionPosition(position: number) {
	const normalized = Math.min(1, Math.max(0, position));
	const scaled = normalized * (selectionStops.length - 1);
	const start = Math.floor(scaled);
	const end = Math.min(start + 1, selectionStops.length - 1);
	return {
		segment: start,
		mix: Math.round((scaled - start) * 1000) / 10,
		terminal: start === end,
	};
}

const segmentClassNames = selectionStops.map(
	(style) => stylex.props(style).className ?? "",
);
const darkInkClassName = stylex.props(selectionStyles.darkInk).className ?? "";
const selectionClasses = new Set(
	[...segmentClassNames, darkInkClassName].flatMap(
		(className) => className.split(" "),
	),
);

function clearSelectionClass(owner: HTMLElement) {
	const className = (owner.getAttribute("class") ?? "")
		.split(" ")
		.filter((name) => name && !selectionClasses.has(name))
		.join(" ");
	delete owner.dataset["selectionMix"];
	if (className) owner.setAttribute("class", className);
	else owner.removeAttribute("class");
}

function applySelectionClass(owner: HTMLElement, position: number) {
	clearSelectionClass(owner);
	const { segment, mix, terminal } = selectionPosition(position);
	const current = owner.getAttribute("class");
	const segmentClassName = segmentClassNames[segment] ?? segmentClassNames[0];
	const className = `${segmentClassName} ${darkInkClassName}`;
	if (!terminal) owner.dataset["selectionMix"] = `${mix}%`;
	owner.setAttribute("class", current ? `${current} ${className}` : className);
}

function selectedTextOwners(selection: Selection) {
	const owners = new Set<HTMLElement>();
	const include = (node: Node, range: Range) => {
		if (
			!(node instanceof Text) ||
			!node.data.trim() ||
			!range.intersectsNode(node)
		)
			return;
		const parent = node.parentElement;
		if (parent && !parent.closest('[aria-hidden="true"], [inert]'))
			owners.add(parent);
	};

	for (let index = 0; index < selection.rangeCount; index += 1) {
		const range = selection.getRangeAt(index);
		if (range.commonAncestorContainer instanceof Text) {
			include(range.commonAncestorContainer, range);
			continue;
		}
		const walker = document.createTreeWalker(
			range.commonAncestorContainer,
			NodeFilter.SHOW_TEXT,
		);
		for (let node = walker.nextNode(); node; node = walker.nextNode())
			include(node, range);
	}
	return owners;
}

export function useSkySelection() {
	useEffect(() => {
		let owners = new Set<HTMLElement>();
		let frame = 0;

		const clear = () => {
			for (const owner of owners) clearSelectionClass(owner);
			owners.clear();
		};
		const update = () => {
			frame = 0;
			clear();
			const selection = document.getSelection();
			if (!selection || selection.isCollapsed || selection.rangeCount === 0)
				return;
			owners = selectedTextOwners(selection);
			for (const owner of owners) {
				const bounds = owner.getBoundingClientRect();
				const position = (bounds.top + bounds.height / 2) / window.innerHeight;
				applySelectionClass(owner, position);
			}
		};
		const schedule = () => {
			if (!frame) frame = window.requestAnimationFrame(update);
		};
		const scheduleSelected = () => {
			if (owners.size > 0) schedule();
		};

		document.addEventListener("selectionchange", schedule);
		window.addEventListener("resize", scheduleSelected);
		window.addEventListener("scroll", scheduleSelected, { passive: true });
		return () => {
			document.removeEventListener("selectionchange", schedule);
			window.removeEventListener("resize", scheduleSelected);
			window.removeEventListener("scroll", scheduleSelected);
			window.cancelAnimationFrame(frame);
			clear();
		};
	}, []);
}
