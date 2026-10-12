export const assets = {
	brandLogo: "/images/localai_light.svg",
	mark: "/images/optimized.svg",
	favicon: "/images/favicon.svg",
	faviconDark: "/images/favicon-dark.svg",
	localaiDark: "/images/localai_dark.svg",
	shotAgents: "/images/v3-agents.png",
	shotAgents800: "/images/v3-agents-800.png",
	shotAgents1300: "/images/v3-agents-1300.png",
	shotAgents2600: "/images/v3-agents-2600.png",
	shotServe: "/images/v3-serve.png",
	shotServe800: "/images/v3-serve-800.png",
	shotServe1300: "/images/v3-serve-1300.png",
	shotServe2600: "/images/v3-serve-2600.png",
	shotFleet: "/images/v3-fleet.png",
	shotFleet800: "/images/v3-fleet-800.png",
	shotFleet1300: "/images/v3-fleet-1300.png",
	shotFleet2600: "/images/v3-fleet-2600.png",
	shotRegistry: "/images/v3-registry.png",
	shotRegistry800: "/images/v3-registry-800.png",
	shotRegistry1300: "/images/v3-registry-1300.png",
	shotRegistry2600: "/images/v3-registry-2600.png",
	shotThread: "/images/v3-thread.png",
	shotThread800: "/images/v3-thread-800.png",
	shotThread1300: "/images/v3-thread-1300.png",
	shotThread2600: "/images/v3-thread-2600.png",
	phone01: "/images/v3-phone-01-660.png",
	phone01_2x: "/images/v3-phone-01.png",
	phone02: "/images/v3-phone-02-660.png",
	phone02_2x: "/images/v3-phone-02.png",
	phone03: "/images/v3-phone-03-660.png",
	phone03_2x: "/images/v3-phone-03.png",
	phone04: "/images/v3-phone-04-660.png",
	phone04_2x: "/images/v3-phone-04.png",
	launchVideo: "/media/local-studio-3.0-launch.mp4",
	launchPoster: "/images/v3-launch-poster.png",
	sponsorNvidia: "/images/sponsors/nvidia.svg",
	sponsorFactory: "/images/sponsors/factory.svg",
	sponsorLambda: "/images/sponsors/lambda.svg",
	sponsorPrime: "/images/sponsors/prime-intellect.svg",
	sponsorTng: "/images/sponsors/tng.svg",
	fontSans: "/fonts/geist-sans.woff2",
	fontMono: "/fonts/geist-mono.woff2",
	logoMesh: "/localai/localai-logo.gltf",
	logoMeshBin: "/localai/localai-logo.bin",
	dayEnv: "/localai/day-sky-cubemap.jpg",
	nightEnv: "/localai/night-sky-cubemap.jpg",
	heroRenderDay: "/localai/hero-render-day.png",
	heroRenderNight: "/localai/hero-render-night.png",
} as const;

const registered = new Set<string>(Object.values(assets));

export function responsiveSrcSet(path: string) {
	const base = path.replace(/\.png$/, "");
	const variants = [`${base}-800.png`, `${base}-1300.png`, `${base}-2600.png`];
	for (const variant of variants) {
		if (!registered.has(variant)) {
			throw new Error(`unregistered srcset variant: ${variant}`);
		}
	}
	return `${variants[0]} 800w, ${variants[1]} 1300w, ${variants[2]} 2600w`;
}

export const heroSizes = "min(1399px, calc(100vw - 48px))";
export const frameSizes = "(min-width: 900px) 790px, calc(100vw - 48px)";
