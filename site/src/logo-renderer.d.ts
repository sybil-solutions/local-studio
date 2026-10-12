declare module "@local-ai/logo-renderer/react" {
	import type { ComponentType } from "react";
	export const LogoPoster: ComponentType<{ dayUrl: string; nightUrl: string }>;
	const LocalAiLogoShader: ComponentType<{
		modelUrl: string;
		fallbackUrl: string;
		dayUrl: string;
		nightUrl: string;
		onFirstFrame?: (() => void) | undefined;
		sx?: import("./styles/base-styles").PublicStyle | undefined;
		viewportAspect?: number | undefined;
		staticPose?: boolean | undefined;
	}>;
	export default LocalAiLogoShader;
	export { LocalAiLogoShader };
}
