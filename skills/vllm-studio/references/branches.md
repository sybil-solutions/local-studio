# Branch + Release Workflow

## Checkout / update
```
git fetch origin

git checkout <branch>
git pull --ff-only
```

## Merge to main
```
git checkout main
git pull --ff-only

git merge <feature-branch>
```

## Release steps
1. Update `CHANGELOG.md` with release date + entries.
2. Tag release:
```
git tag -a vX.Y.Z -m "vX.Y.Z"
```
3. Push:
```
git push origin main --tags
```

## Verification gates (default)
- `cd controller && bun run typecheck && bun test`
- `cd frontend && npm run build && npm run lint`
- `docker compose up -d --build frontend`
