import { lazy, Suspense, useState } from "react";
import { LogoPoster } from "@local-ai/logo-renderer/react";
import { assets } from "../domain/asset";

const Shader = lazy(() => import("./shader"));

// Poster renders outside the Suspense boundary for the first client paint.
export function LocalAiLogo() {
	const [ready, setReady] = useState(false);
	return (
		<>
			<Suspense fallback={null}>
				<Shader onFirstFrame={() => setReady(true)} />
			</Suspense>
			{!ready && (
				<LogoPoster dayUrl={assets.heroRenderDay} nightUrl={assets.heroRenderNight} />
			)}
		</>
	);
}
