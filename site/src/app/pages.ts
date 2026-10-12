import { lazy, type ComponentType } from "react";
import { DocsPage } from "../pages/DocsPage";
import { HomePage } from "../pages/HomePage";
import { PromptPage } from "../pages/PromptPage";
import { ResourcesPage } from "../pages/ResourcesPage";
import {
	docsPath,
	downloadPath,
	homePath,
	machinePath,
	overviewPath,
	productPath,
	setupPath,
	type RoutePath,
} from "../domain/route";

export const pages = {
	[homePath]: HomePage,
	[productPath]: lazy(() =>
		import("../pages/ProductPage").then(({ ProductPage }) => ({ default: ProductPage })),
	),
	[docsPath]: DocsPage,
	[setupPath]: PromptPage,
	[downloadPath]: lazy(() =>
		import("../pages/DownloadPage").then(({ DownloadPage }) => ({ default: DownloadPage })),
	),
	[overviewPath]: ResourcesPage,
	[machinePath]: lazy(() =>
		import("../pages/MachinePage").then(({ MachinePage }) => ({ default: MachinePage })),
	),
} as const satisfies Record<RoutePath, ComponentType>;

