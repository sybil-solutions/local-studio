import { baseStyles, type PublicStyle } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { ChevronDown, Equal, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { site } from "../domain/site";
import { downloadLabel, downloadPath, homePath, productNav, resourceNav } from "../domain/route";
import {
	closedNav,
	desktopMenu,
	isMobileOpen,
	reduceNav,
	type MenuId,
	type NavSurface,
} from "../domain/nav";
import { DownloadButton } from "./Links";
import { BrandLogo } from "./BrandLogo";
import { LocalLink } from "./LocalLink";
import { headerStyles } from "../styles/header-styles";

type NavLink = {
	readonly label: string;
	readonly href: string;
	readonly external?: true;
}

type ChevronProps = {
	open: boolean;
}

type MenuListProps = {
	items: readonly NavLink[];
	onNavigate: () => void;
	sx?: PublicStyle;
	itemSx?: PublicStyle;
	desktop?: boolean;
}

const products = productNav();

const resources = resourceNav().map((item) => ({
	label: item.label,
	href: item.href,
})) satisfies readonly NavLink[];

const menuColumns = {
	products: [products],
	resources: [resources],
} as const satisfies Record<MenuId, readonly (readonly NavLink[])[]>;
const githubUrl = site.products.localStudio.repository;
const mobileQuery = "(max-width: 900px)";

function Chevron({ open }: ChevronProps) {
	return (
		<ChevronDown
			size={14}
			strokeWidth={1.25}
			aria-hidden="true"
			{...stylex.props(headerStyles.chevron, open && headerStyles.chevronOpen)}
		/>
	);
}

function GitHubMark() {
	return (
		<svg {...stylex.props(baseStyles.graphic, baseStyles.element, headerStyles.githubIcon)} viewBox="0 0 24 24" aria-hidden="true">
			<path
				fill="currentColor"
				d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.11.79-.25.79-.56v-2.23c-3.23.7-3.91-1.37-3.91-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.58-.29-5.29-1.29-5.29-5.68 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.75 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.4-2.72 5.38-5.31 5.67.42.36.79 1.07.79 2.16v3.2c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z"
			 {...stylex.props(baseStyles.element)}/>
		</svg>
	);
}

function MenuItems({
	items,
	onNavigate,
	sx = headerStyles.menuItems,
	itemSx = headerStyles.menuItem,
	desktop = false,
}: MenuListProps) {
	return (
		<ul {...stylex.props(baseStyles.list, baseStyles.element, sx)} role={desktop ? "none" : undefined}>
			{items.map((item) => (
				<li key={item.label} role={desktop ? "none" : undefined} {...stylex.props(baseStyles.element)}>
					{item.external ? (
						<a
							{...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, itemSx)}
							href={item.href}
							target="_blank"
							rel="noreferrer"
							onClick={onNavigate}
							role={desktop ? "menuitem" : undefined}
						>
							{item.label}
						</a>
					) : (
						<LocalLink
							sx={itemSx}
							href={item.href}
							onClick={onNavigate}
							role={desktop ? "menuitem" : undefined}
						>
							{item.label}
						</LocalLink>
					)}
				</li>
			))}
		</ul>
	);
}

function DesktopMenu({
	menu,
	onNavigate,
}: {
	menu: MenuId;
	onNavigate: () => void;
}) {
	const label = menu === "products" ? "Products" : "Resources";
	const innerRef = useRef<HTMLDivElement>(null);
	const [offset, setOffset] = useState(0);
	useLayoutEffect(() => {
		function sync() {
			const trigger = document.querySelector<HTMLElement>(
				`[aria-controls="nav-menu-${menu}"]`,
			);
			const inner = innerRef.current;
			if (!trigger || !inner) return;
			const triggerText =
				trigger.getBoundingClientRect().left -
				inner.getBoundingClientRect().left +
				Number.parseFloat(getComputedStyle(trigger).paddingLeft);
			setOffset(triggerText);
		}
		sync();
		window.addEventListener("resize", sync);
		return () => window.removeEventListener("resize", sync);
	}, [menu]);

	return (
		<div
			{...stylex.props(baseStyles.element, headerStyles.mega, menu === "resources" && headerStyles.megaResources)}
			id={`nav-menu-${menu}`}
			aria-label={`${label} menu`}
			role="menu"
			onKeyDown={(event) => {
				if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
				const items = [
					...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
				];
				if (items.length === 0) return;
				const current = items.findIndex((item) => item === document.activeElement);
				const next =
					event.key === "Home"
						? 0
						: event.key === "End"
							? items.length - 1
							: (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
								items.length;
				event.preventDefault();
				items[next]?.focus();
			}}
		>
			<div {...stylex.props(baseStyles.element, headerStyles.megaInner)} ref={innerRef}>
				<div {...stylex.props(baseStyles.element, headerStyles.megaGrid(offset))}>
					{(menuColumns[menu] ?? []).map((column) => (
						<section {...stylex.props(baseStyles.element, headerStyles.megaSection)} key={column[0]?.label ?? menu}>
							<MenuItems items={column} onNavigate={onNavigate} desktop />
						</section>
					))}
				</div>
			</div>
		</div>
	);
}

function MobileMenuGroup({
	label,
	items,
	onNavigate,
}: {
	label: string;
	items: readonly NavLink[];
	onNavigate: () => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<details
			name="mobile-nav"
			{...stylex.props(baseStyles.element, headerStyles.sheetGroup)}
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary {...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, headerStyles.sheetSummary)}>
				{label}
				<ChevronDown
					{...stylex.props(headerStyles.sheetChevron, open && headerStyles.chevronOpen)}
					size={20}
					strokeWidth={1.25}
					aria-hidden="true"
				/>
			</summary>
			<MenuItems
				items={items}
				onNavigate={onNavigate}
				sx={headerStyles.sheetItems}
				itemSx={headerStyles.sheetItem}
			/>
		</details>
	);
}

export function Header() {
	const [nav, setNav] = useState<NavSurface>(closedNav);
	const openMenu = desktopMenu(nav);
	const mobileOpen = isMobileOpen(nav);
	const menusRef = useRef<HTMLElement>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const sheetRef = useRef<HTMLDialogElement>(null);
	const closeTimerRef = useRef<number | null>(null);
	const sheetId = useId();

	function cancelMenuClose() {
		if (closeTimerRef.current === null) return;
		window.clearTimeout(closeTimerRef.current);
		closeTimerRef.current = null;
	}

	function close() {
		cancelMenuClose();
		setNav(closedNav);
	}

	function scheduleMenuClose() {
		cancelMenuClose();
		closeTimerRef.current = window.setTimeout(() => {
			setNav(closedNav);
			closeTimerRef.current = null;
		}, 100);
	}

	useEffect(() => {
		if (!openMenu) return;
		function onPointerDown(event: PointerEvent) {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (!menusRef.current?.contains(target)) {
				setNav(closedNav);
			}
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				const trigger = menusRef.current?.querySelector<HTMLButtonElement>(
					`[aria-controls="nav-menu-${openMenu}"]`,
				);
				setNav(closedNav);
				trigger?.focus();
			}
		}
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [openMenu]);


	useEffect(() => {
		const media = window.matchMedia(mobileQuery);
		function onChange() {
			if (media.matches) setNav(closedNav);
			if (!media.matches) setSheetOpen(false);
		}
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);


	useEffect(() => {
		const main = document.getElementById("content");
		const footer = document.querySelector("footer");
		main?.toggleAttribute("inert", mobileOpen);
		footer?.toggleAttribute("inert", mobileOpen);
		if (!mobileOpen) return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				setSheetOpen(false);
				toggleRef.current?.focus();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => {
			main?.removeAttribute("inert");
			footer?.removeAttribute("inert");
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [mobileOpen]);

	useEffect(() => {
		const sheet = sheetRef.current;
		if (!sheet) return;
		if (mobileOpen && !sheet.open) sheet.show();
		if (!mobileOpen && sheet.open) sheet.close();
	}, [mobileOpen]);

	function setSheetOpen(open: boolean) {
		for (const element of [document.documentElement, document.body]) {
			if (open) element.dataset["navOpen"] = "true";
			else delete element.dataset["navOpen"];
		}
		setNav((current) =>
			reduceNav(current, open ? { type: "openMobile" } : { type: "closeMobile" }),
		);
	}

	const closeMobile = () => setSheetOpen(false);

	function menu(id: MenuId, label: string) {
		const open = openMenu === id;
		return (
			<div {...stylex.props(baseStyles.element, headerStyles.menu)}>
				<button
					type="button"
					{...stylex.props(
					baseStyles.element,
					baseStyles.interactive,
					baseStyles.focusable,
					baseStyles.button,
					headerStyles.menuTrigger,
					stylex.defaultMarker(),
					open && headerStyles.menuTriggerOpen,
				)}
					aria-haspopup="menu"
					aria-expanded={open}
					aria-controls={`nav-menu-${id}`}
					onClick={(event) =>
						setNav(
							event.detail === 0 && open
								? closedNav
								: reduceNav(nav, { type: "openDesktop", menu: id }),
						)
					}
					onPointerEnter={() => setNav({ kind: "desktop", menu: id })}
					onKeyDown={(event) => {
						if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
						event.preventDefault();
						setNav({ kind: "desktop", menu: id });
						window.requestAnimationFrame(() => {
							const items = menusRef.current?.querySelectorAll<HTMLElement>(
								`#nav-menu-${id} [role="menuitem"]`,
							);
							items?.[event.key === "ArrowDown" ? 0 : items.length - 1]?.focus();
						});
					}}
				>
					<span
						{...stylex.props(baseStyles.element, headerStyles.triggerSurface)}
						aria-hidden="true"
					/>
					{label}
					<Chevron open={open} />
				</button>
			</div>
		);
	}

	return (
		<>
			{mobileOpen ? <div {...stylex.props(baseStyles.element, headerStyles.spacer)} /> : null}
		<header
			ref={menusRef}
			{...stylex.props(baseStyles.element, headerStyles.nav, mobileOpen && headerStyles.navOpen)}
			onPointerOver={cancelMenuClose}
			onPointerLeave={scheduleMenuClose}
		>
			<span {...stylex.props(baseStyles.element, headerStyles.navBackdrop, mobileOpen && headerStyles.navBackdropOpen, openMenu === "products" && headerStyles.navBackdropProducts, openMenu === "resources" && headerStyles.navBackdropResources)} />
			<div {...stylex.props(baseStyles.element, headerStyles.primary)}>
				<LocalLink
					sx={headerStyles.brand}
					href={homePath}
					aria-label={site.products.localStudio.name}
					onClick={closeMobile}
					onPointerEnter={close}
				>
					<BrandLogo />
				</LocalLink>
				<nav {...stylex.props(baseStyles.element, headerStyles.links)} aria-label="Landing navigation">
					{menu("products", "Products")}
					{menu("resources", "Resources")}
					<a
						{...stylex.props(
							baseStyles.element,
							baseStyles.interactive,
							baseStyles.focusable,
							headerStyles.topLink,
							stylex.defaultMarker(),
						)}
						href={site.company.url}
						onPointerEnter={close}
					>
						<span
							{...stylex.props(baseStyles.element, headerStyles.triggerSurface)}
							aria-hidden="true"
						/>
						Company
					</a>
				</nav>
			</div>
			<div {...stylex.props(baseStyles.element, headerStyles.actions)}>
				<LocalLink
					sx={headerStyles.github}
					href={githubUrl}
					target="_blank"
					rel="noreferrer"
					aria-label={`${site.products.localStudio.name} on GitHub`}
					onPointerEnter={close}
				>
					<GitHubMark />
				</LocalLink>
				<DownloadButton sx={headerStyles.button} />
			</div>
			{openMenu ? (
				<DesktopMenu menu={openMenu} onNavigate={close} />
			) : null}
			<button
				ref={toggleRef}
				type="button"
				{...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, baseStyles.button, headerStyles.toggle)}
				aria-label={mobileOpen ? "Close menu" : "Open menu"}
				aria-expanded={mobileOpen}
				aria-controls={sheetId}
				onClick={() => setSheetOpen(!mobileOpen)}
			>
				{mobileOpen ? (
					<X size={22} strokeWidth={1.5} aria-hidden="true" />
				) : (
					<Equal size={22} strokeWidth={1.5} aria-hidden="true" />
				)}
			</button>
			<dialog
				id={sheetId}
				ref={sheetRef}
				{...stylex.props(baseStyles.dialog, baseStyles.element, headerStyles.sheet, mobileOpen && headerStyles.sheetOpen)}
				aria-modal={mobileOpen || undefined}
				aria-label="Navigation menu"
				aria-hidden={!mobileOpen}
				inert={!mobileOpen || undefined}
			>
				<nav {...stylex.props(baseStyles.element, headerStyles.sheetNav)} aria-label="Mobile navigation">
					<MobileMenuGroup label="Products" items={products} onNavigate={closeMobile} />
					<MobileMenuGroup label="Resources" items={resources} onNavigate={closeMobile} />
					<a
						{...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, headerStyles.sheetItem, headerStyles.sheetLink)}
						href={site.company.url}
						onClick={closeMobile}
					>
						<span
							{...stylex.props(baseStyles.element, headerStyles.triggerSurface)}
							aria-hidden="true"
						/>
						Company
					</a>
				</nav>
				<div {...stylex.props(baseStyles.element, headerStyles.sheetActions)}>
					<LocalLink
						sx={[headerStyles.button, headerStyles.sheetAction]}
						href={downloadPath}
						onClick={closeMobile}
					>
						{downloadLabel()}
					</LocalLink>
					<a
						{...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, headerStyles.textLink, headerStyles.sheetAction)}
						href={githubUrl}
						target="_blank"
						rel="noreferrer"
						onClick={closeMobile}
					>
						<GitHubMark />
						GitHub
					</a>
				</div>
			</dialog>
		</header>
		</>
	);
}
