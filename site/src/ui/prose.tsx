import type { ReactNode } from "react";
import type { Prose } from "../content/product";

export function renderInlineReact(prose: Prose): ReactNode {
	return prose.map((part, index) =>
		part.kind === "text" ? (
			part.text
		) : (
			<span key={`${part.term}-${index}`} translate="no">
				{part.term}
			</span>
		),
	);
}
