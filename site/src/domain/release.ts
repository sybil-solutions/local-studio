import { downloadPath } from "./route.ts";
import { site } from "./site.ts";

const repository = site.products.localStudio.repository;

export const release = {
	major: "3.0",
	repository,
	releases: `${repository}/releases`,
	latest: `${repository}/releases/latest`,
	api: "/api/release",
	publisher: "github-actions[bot]",
	manifest: "Local-Studio-manifest.json",
	sums: "SHA256SUMS",
	sitePath: downloadPath,
} as const;

export const downloadTargets = {
	macos: { asset: "Local-Studio-mac-arm64.dmg", label: "macOS" },
	"macos-arm64": { asset: "Local-Studio-mac-arm64.dmg", label: "macOS (Apple silicon)" },
	"macos-x64": { asset: "Local-Studio-mac-x64.dmg", label: "macOS (Intel)" },
	windows: { asset: "Local-Studio-win-x64.exe", label: "Windows" },
	linux: { asset: "Local-Studio-linux-x64.AppImage", label: "Linux" },
	"linux-arm64": { asset: "Local-Studio-linux-arm64.AppImage", label: "Linux (arm64)" },
} as const;

export type DownloadTarget = keyof typeof downloadTargets;
export type Platform = "macos" | "windows" | "linux";

export function isDownloadTarget(value: string): value is DownloadTarget {
	return Object.prototype.hasOwnProperty.call(downloadTargets, value);
}

export const downloadTargetNames = Object.keys(downloadTargets).filter(isDownloadTarget);

export function downloadHref(target: DownloadTarget): string {
	return `${downloadPath}/${target}`;
}

export function detectPlatform(userAgent: string): Platform | null {
	if (/iPhone|iPad|Android/i.test(userAgent)) return null;
	if (/Windows/i.test(userAgent)) return "windows";
	if (/Macintosh|Mac OS X/i.test(userAgent)) return "macos";
	if (/Linux|X11/i.test(userAgent)) return "linux";
	return null;
}

export type ReleaseAsset = {
	readonly name: string;
	readonly url: string;
	readonly size: number;
	readonly sha256: string;
};

export type ReleaseSummary = {
	readonly version: string;
	readonly publishedAt: string;
	readonly pageUrl: string;
	readonly sumsUrl: string | null;
	readonly assets: readonly ReleaseAsset[];
};

type DownloadRow = {
	readonly label: string;
	readonly detail: string;
	readonly match: RegExp;
	readonly target?: DownloadTarget;
};

export type DownloadGroup = {
	readonly id: Platform | "controller";
	readonly title: string;
	readonly rows: readonly DownloadRow[];
	readonly notes: readonly string[];
};

export const downloadGroups: readonly DownloadGroup[] = [
	{
		id: "macos",
		title: "macOS",
		rows: [
			{ label: "Apple silicon", detail: "DMG installer, M1 and newer", match: /^Local-Studio-mac-arm64\.dmg$/, target: "macos-arm64" },
			{ label: "Intel", detail: "DMG installer", match: /^Local-Studio-mac-x64\.dmg$/, target: "macos-x64" },
			{ label: "Apple silicon", detail: "ZIP archive", match: /^Local-Studio-[\d.]+-arm64\.zip$/ },
			{ label: "Intel", detail: "ZIP archive", match: /^Local-Studio-[\d.]+-x64\.zip$/ },
		],
		notes: [
			"Signed and notarized by Apple. Open the DMG and drag Local Studio into Applications.",
			"The app updates itself after that.",
		],
	},
	{
		id: "windows",
		title: "Windows",
		rows: [
			{ label: "x64", detail: "Installer for Windows 10 and 11", match: /^Local-Studio-win-x64\.exe$/, target: "windows" },
		],
		notes: [
			"The installer is not code-signed yet. If SmartScreen appears, choose More info, then Run anyway.",
		],
	},
	{
		id: "linux",
		title: "Linux",
		rows: [
			{ label: "x64", detail: "AppImage", match: /^Local-Studio-linux-x64\.AppImage$/, target: "linux" },
			{ label: "arm64", detail: "AppImage, DGX Spark and Jetson", match: /^Local-Studio-linux-arm64\.AppImage$/, target: "linux-arm64" },
			{ label: "x64", detail: "Debian and Ubuntu package", match: /amd64\.deb$/ },
			{ label: "arm64", detail: "Debian and Ubuntu package", match: /arm64\.deb$/ },
		],
		notes: [
			"AppImage: chmod +x the file, then run it.",
			"Debian or Ubuntu: sudo apt install ./Local-Studio-*.deb",
		],
	},
	{
		id: "controller",
		title: "Controller only",
		rows: [
			{ label: "Linux x64", detail: "Headless controller", match: /^local-studio-controller-linux-x64$/ },
			{ label: "Linux arm64", detail: "Headless controller, DGX Spark and Jetson", match: /^local-studio-controller-linux-arm64$/ },
			{ label: "macOS Apple silicon", detail: "Headless controller", match: /^local-studio-controller-darwin-arm64$/ },
			{ label: "macOS Intel", detail: "Headless controller", match: /^local-studio-controller-darwin-x64$/ },
			{ label: "Windows x64", detail: "Headless controller", match: /^local-studio-controller-windows-x64\.exe$/ },
		],
		notes: [
			"For GPU machines without the desktop app. Settings → Local → Install sets one up over ssh on any Linux or macOS machine on your tailnet.",
			"By hand: chmod +x the binary and start it. It listens on 127.0.0.1:18091.",
		],
	},
];
