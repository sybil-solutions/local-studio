# Contributing

Thanks for wanting to improve vLLM Studio. This project moves quickly, so contributions should be small, focused, and easy to review.

## Before opening a PR

1. Start from the latest `main`.
2. Keep one logical change per branch.
3. Avoid broad formatting-only rewrites.
4. Do not commit secrets, `.env.local`, logs with credentials, model tokens, or generated build artifacts.
5. If your change affects UI behavior, include a test or explain why a test is not practical.

## Local validation

Run the relevant checks before opening a PR:

```bash
# Full repo gate
npm run check

# Integration and e2e tests
npm run test:e2e
```

For desktop changes, also run:

```bash
cd frontend
npm run desktop:dist
```

## Pull request expectations

PRs should include:

- A concise summary of the change.
- The validation commands you ran.
- Screenshots or short screen recordings for UI changes.
- Notes about migration, deployment, or compatibility risks.

## Issue policy

Issues are for reproducible bugs, scoped feature requests, and release-blocking regressions. Please include:

- OS and environment details.
- Controller/frontend versions or commit SHA.
- Exact reproduction steps.
- Relevant logs or screenshots.

Broad roadmap discussions and unsupported configuration requests may be closed so active work stays focused.

## Release process

Maintainers merge to `main`. The release workflow runs semantic-release and creates GitHub releases from conventional commits.
