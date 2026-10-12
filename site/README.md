# localstudio.ai

Folded in from the former [sybil-solutions/local-studio-site](https://github.com/sybil-solutions/local-studio-site) repository
(archived): the site source, the Cloudflare Worker and the deploy config live here, in `local-studio`, and `site/` is the whole
of that repository at the same paths, with its history.

### Acknowledgements

The renderer and model is built with heavy inspiration from https://eve.dev. We thank the creators of Vercel for their talents and design sense.

### Deploy

The site is a Vite SPA served by a Cloudflare Worker (`src/worker/index.ts`, `wrangler.jsonc`). The Worker owns `/download/*` (verified GitHub release redirects), `/api/*`, the MCP endpoint, markdown negotiation and agent documents; static media is served straight from assets.

```sh
pnpm deploy:preview      # local-studio-site-preview on workers.dev
pnpm deploy:production   # local-studio-site on localstudio.ai and www.localstudio.ai
```

Both commands run from `site/` (or with `pnpm --dir site`). The worker name and the `localstudio.ai` and
`www.localstudio.ai` routes are unchanged, so a deploy updates the worker that is live now.

`.github/workflows/site.yml` runs the checks on every change under `site/` and, on a manual dispatch with
`deploy: true`, the production deploy after them. It needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
repository secrets, which the previous repository did not carry: the site was deployed by hand, so set them before
dispatching the deploy job (the checks job needs neither).

Set `GITHUB_TOKEN` with `wrangler secret put GITHUB_TOKEN` to raise the GitHub API rate limit for release verification.
