import { baseStyles, type PublicStyle } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { pushNavigation, scrollToHash } from "../app/browser-location";
import { decideSameOriginNavigation } from "../domain/route";

type LocalLinkProps = Omit<
	AnchorHTMLAttributes<HTMLAnchorElement>,
	"className" | "style"
> & {
	children: ReactNode;
	href: string;
	sx?: PublicStyle;
};

export function LocalLink({
	children,
	href,
	onClick,
	sx,
	...props
}: LocalLinkProps) {
	function handleClick(event: MouseEvent<HTMLAnchorElement>) {
		onClick?.(event);
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey ||
			props.target
		) {
			return;
		}

		const decision = decideSameOriginNavigation(
			href,
			window.location.origin,
			`${window.location.pathname}${window.location.search}${window.location.hash}`,
		);
		if (decision.kind === "external") return;
		event.preventDefault();
		if (decision.kind === "push") {
			pushNavigation(decision.next);
			return;
		}
		if (decision.kind === "hash") {
			scrollToHash(decision.hash);
			return;
		}
		window.scrollTo({ top: 0 });
	}

	return (
		<a {...stylex.props(baseStyles.element, baseStyles.interactive, baseStyles.focusable, sx)} href={href} onClick={handleClick} {...props}>
			{children}
		</a>
	);
}
