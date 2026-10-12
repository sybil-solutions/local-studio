import { createElement } from "react";
import { assets } from "../domain/asset";
import { LocalAiLogoShader as LogoRenderer } from "@local-ai/logo-renderer/react";

export default function LocalAiLogoShader(props: {
	onFirstFrame?: (() => void) | undefined;
}) {
	return createElement(LogoRenderer, {
		modelUrl: assets.logoMesh,
		fallbackUrl: assets.localaiDark,
		dayUrl: assets.dayEnv,
		nightUrl: assets.nightEnv,
		...props,
	});
}
