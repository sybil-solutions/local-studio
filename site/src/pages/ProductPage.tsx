import { baseStyles } from "../styles/base-styles";
import * as stylex from "@stylexjs/stylex";
import { docsPath, productPath, routes } from "../domain/route";
import { CtaPair } from "../components/Links";
import { MediaFrame } from "../components/MediaFrame";
import { PageIntro } from "../components/PageIntro";
import { PageShell } from "../components/PageShell";
import { productFeatures } from "../content/product";
import { renderInlineReact } from "../ui/prose";
import { assets, frameSizes, heroSizes, responsiveSrcSet } from "../domain/asset";
import { site } from "../domain/site";
import { upstreamCredit } from "../content/facts";
import { styles } from "../styles/pages-styles";

export function ProductPage() {
	return (
		<PageShell>
			<PageIntro
				id="product-title"
				title={routes[productPath].heading}
				description={
					<>
						<span translate="no" {...stylex.props(baseStyles.element)}>{site.products.localStudio.name}</span> runs every
						coding agent on your own models, across every machine you own. {upstreamCredit}
					</>
				}
				actions={
					<CtaPair
						secondary={{ href: docsPath, label: "Read the docs" }}
					/>
				}
			/>
			<section
				{...stylex.props(baseStyles.element, styles.sectionWidth, styles.pageBottom)}
				aria-label="Product capabilities"
			>
				<MediaFrame
					sx={styles.productHero}
					src={assets.shotThread1300}
					srcSet={responsiveSrcSet(assets.shotThread)}
					sizes={heroSizes}
					alt={`${site.products.localStudio.name} thread with an agent answer, code and changed files.`}
					width="2880"
					height="2200"
					fetchPriority="high"
				/>
				{productFeatures.map((section, index) => (
					<article
						{...stylex.props(baseStyles.element, 
							styles.productArticle,
							index % 2
								? styles.productArticleOdd
								: styles.productArticleEven,
						)}
						key={section.productTitle}
					>
						<div {...stylex.props(baseStyles.element, index % 2 !== 0 && styles.productCopyOdd)}>
							<h2 {...stylex.props(baseStyles.element, baseStyles.heading, baseStyles.headingTwo)}>
								{section.productTitle}
							</h2>
							<p {...stylex.props(baseStyles.element, baseStyles.paragraph, styles.productText)}>
								{renderInlineReact(section.productText)}
							</p>
						</div>
						<MediaFrame
							sx={index % 2 !== 0 ? styles.productMediaOdd : undefined}
							src={section.image}
							srcSet={responsiveSrcSet(section.image)}
							sizes={frameSizes}
							alt={section.alt}
							width="2880"
							height="2200"
							loading="lazy"
							decoding="async"
						/>
					</article>
				))}
			</section>
		</PageShell>
	);
}
