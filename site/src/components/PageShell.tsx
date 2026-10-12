import { baseStyles } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { site } from "../domain/site";
import { shellStyles } from "../styles/shell-styles";
import { BrandLogo } from "./BrandLogo";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { LocalLink } from "./LocalLink";

interface PageShellProps {
	backHref?: string;
	children: ReactNode;
}

export function PageShell({ backHref, children }: PageShellProps) {
	return (
		<div {...stylex.props(baseStyles.element, shellStyles.shell, backHref !== undefined && shellStyles.backShell)}>
			<LocalLink sx={shellStyles.skipLink} href="#content">
				Skip to content
			</LocalLink>
			{backHref ? (
				<header {...stylex.props(baseStyles.element, shellStyles.backNav)}>
					<LocalLink
						sx={shellStyles.brand}
						href={backHref}
						aria-label={site.products.localStudio.name}
					>
						<BrandLogo />
					</LocalLink>
					<LocalLink sx={shellStyles.backLink} href={backHref}>
						<ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
						Back
					</LocalLink>
				</header>
			) : (
				<Header />
			)}
			<main {...stylex.props(baseStyles.element, shellStyles.main, backHref !== undefined && shellStyles.backMain)} id="content" tabIndex={-1}>
				{children}
			</main>
			<Footer sx={backHref ? shellStyles.backFooter : undefined} />
		</div>
	);
}
