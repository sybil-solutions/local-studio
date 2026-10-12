import * as stylex from "@stylexjs/stylex";

export const rendererTimes = stylex.defineVars({
	fade: stylex.types.time({
		default: "240ms",
		"@media (prefers-reduced-motion: reduce)": "0.01ms",
	}),
});
