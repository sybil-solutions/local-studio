import { baseStyles } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import setupPromptTemplate from "../content/setup-prompt.txt?raw";
import { PromptBlock } from "../components/PromptBlock";
import { downloadPath, overviewPath, routes, setupPath } from "../domain/route";
import { CtaPair } from "../components/Links";
import { PageIntro } from "../components/PageIntro";
import { PageShell } from "../components/PageShell";
import { site } from "../domain/site";
import { styles } from "../styles/pages-styles";

const setupPrompt = setupPromptTemplate
	.replaceAll("{{LOCAL_STUDIO_DOWNLOAD}}", `${site.origin}${downloadPath}`)
	.replaceAll("{{LOCAL_STUDIO_REPOSITORY}}", site.products.localStudio.repository);

export function PromptPage() {
	return (
		<PageShell>
			<PageIntro
				layout="left"
				id="prompt-title"
				title={routes[setupPath].heading}
				description={`It will inspect the machine, install a verified ${site.products.localStudio.name} build, and prove that a model answers through the controller.`}
				actions={
					<CtaPair secondary={{ href: overviewPath, label: "Go to overview" }} />
				}
			/>
			<section
				{...stylex.props(baseStyles.element, styles.sectionWidth, styles.pageBottom)}
				aria-label="Setup handoff"
			>
				<PromptBlock label="Portable setup prompt" text={setupPrompt} />
			</section>
		</PageShell>
	);
}
