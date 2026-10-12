import {
	downloadTargets,
	release,
	type DownloadTarget,
	type ReleaseAsset,
	type ReleaseSummary,
} from "../domain/release.ts";

const repositoryPath = new URL(release.repository).pathname;
const releasesApi = `https://api.github.com/repos${repositoryPath}/releases?per_page=100`;
const sha256 = /^[0-9a-f]{64}$/;
const commitSha = /^[0-9a-f]{40}$/;

type GithubAsset = {
	readonly name?: string;
	readonly browser_download_url?: string;
	readonly digest?: string | null;
	readonly size?: number;
};

type GithubRelease = {
	readonly tag_name?: string;
	readonly draft?: boolean;
	readonly prerelease?: boolean;
	readonly published_at?: string;
	readonly html_url?: string;
	readonly author?: { readonly login?: string };
	readonly assets?: readonly GithubAsset[];
};

type Manifest = {
	readonly schemaVersion?: number;
	readonly version?: string;
	readonly commit?: string;
	readonly assets?: Readonly<Record<string, { readonly sha256?: string }>>;
};

export type VerifiedRelease = ReleaseSummary & { readonly commit: string };

type CacheInit = RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } };

async function githubJson<T>(url: string, token: string | undefined, cacheTtl: number): Promise<T> {
	const headers = new Headers({
		accept: "application/vnd.github+json",
		"user-agent": "localstudio.ai",
	});
	if (token && url.startsWith("https://api.github.com/")) headers.set("authorization", `Bearer ${token}`);
	const init: CacheInit = { headers, cf: { cacheTtl, cacheEverything: true } };
	const response = await fetch(url, init);
	if (!response.ok) throw new Error(`${new URL(url).pathname} returned ${response.status}`);
	const body: T = await response.json();
	return body;
}

function publishedTime(entry: GithubRelease): number {
	const time = Date.parse(entry.published_at ?? "");
	return Number.isFinite(time) ? time : 0;
}

function verifiedAsset(entry: GithubAsset, manifest: Manifest): ReleaseAsset | null {
	const digest = entry.name ? manifest.assets?.[entry.name]?.sha256 : undefined;
	if (!entry.name || !entry.browser_download_url || !digest || !sha256.test(digest)) return null;
	if (entry.digest && entry.digest !== `sha256:${digest}`) return null;
	return { name: entry.name, url: entry.browser_download_url, size: entry.size ?? 0, sha256: digest };
}

async function verify(entry: GithubRelease, token: string | undefined): Promise<VerifiedRelease | null> {
	const version = entry.tag_name?.replace(/^v/, "");
	const manifestAsset = entry.assets?.find((asset) => asset.name === release.manifest);
	if (entry.author?.login !== release.publisher || !version || !manifestAsset?.browser_download_url) return null;
	const manifest = await githubJson<Manifest>(manifestAsset.browser_download_url, token, 3600);
	if (manifest.schemaVersion !== 2 || manifest.version !== version || !commitSha.test(manifest.commit ?? "")) return null;
	const assets = (entry.assets ?? []).flatMap((asset) => {
		const verified = verifiedAsset(asset, manifest);
		return verified ? [verified] : [];
	});
	return {
		version,
		commit: manifest.commit ?? "",
		publishedAt: entry.published_at ?? "",
		pageUrl: entry.html_url ?? `${release.releases}/tag/v${version}`,
		sumsUrl: entry.assets?.find((asset) => asset.name === release.sums)?.browser_download_url ?? null,
		assets,
	};
}

export async function latestVerifiedRelease(
	token: string | undefined,
	accept: (candidate: VerifiedRelease) => boolean = () => true,
): Promise<VerifiedRelease | null> {
	const releases = await githubJson<GithubRelease[]>(releasesApi, token, 60);
	const stable = releases
		.filter((entry) => !entry.draft && !entry.prerelease)
		.sort((left, right) => publishedTime(right) - publishedTime(left));
	for (const entry of stable) {
		const verified = await verify(entry, token).catch(() => null);
		if (verified && accept(verified)) return verified;
	}
	return null;
}

export function targetAsset(candidate: VerifiedRelease, target: DownloadTarget): ReleaseAsset | null {
	return candidate.assets.find((asset) => asset.name === downloadTargets[target].asset) ?? null;
}
