# Releasing Local Studio

Releases are built by `.github/workflows/release.yml` in `sybil-solutions/local-studio`.

## Cutting a release

1. Merge the release branch into `dev`, and make sure CI is green.
2. Tag the commit with `vX.Y.Z` and push the tag, or run **Actions → Release** with `version: X.Y.Z`. Versions below 3.0.0 are refused, because 2.x belongs to the legacy app.
3. Approve the `release-signing` environment when GitHub asks; the macOS jobs need it.
4. Wait for the workflow to publish the GitHub Release. It is marked Latest.
5. Deploy `localstudio.ai`, so the download routes serve the new assets.

## What the workflow builds

| Job                        | Output                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `controller`               | `local-studio-controller-{linux-x64,linux-arm64,darwin-arm64,darwin-x64,windows-x64.exe}`, compiled with Bun                         |
| `desktop-mac` (arm64, x64) | Signed and notarized DMG and zip; verified with `codesign`, `spctl` and `stapler`                                                    |
| `desktop`                  | Windows x64 NSIS installer (unsigned); Linux x64 and arm64 AppImage and `.deb`                                                       |
| `publish`                  | GitHub Release with every asset, stable-named copies, `stable*.yml` updater manifests, `SHA256SUMS` and `Local-Studio-manifest.json` |

Each desktop build compiles the controller for its own platform into `resources/local-controller`.

The stable-named copies are:

- `Local-Studio-mac-arm64.dmg` and `Local-Studio-mac-x64.dmg`
- `Local-Studio-win-x64.exe`
- `Local-Studio-linux-x64.AppImage` and `Local-Studio-linux-arm64.AppImage`

## Signing

The `release-signing` environment holds these secrets:

- `MACOS_CERTIFICATE_P12` (base64)
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

The macOS jobs fail if any of them is missing. Windows installers are not code-signed yet.

## Updates and the legacy app

Local Studio 3.x reads updates from the `stable*.yml` manifests on the latest release.

Legacy Local Studio 2.x (bundle id `org.local.studio.desktop`) reads `latest-mac.yml` and `Local-Studio-release.json` from the latest release. Every 3.x release therefore re-attaches the v2.16.0 copies of those two files. Installs on 2.16.0 then see "no update" and keep working, and they never download the 3.x app.

## Website

`localstudio.ai` (Vercel project `local-studio-site`) serves:

- `/download/macos`
- `/download/macos-arm64`
- `/download/macos-x64`
- `/download/windows`
- `/download/linux`
- `/download/linux-arm64`

Before redirecting to an asset, it checks the release:

- it was published by GitHub Actions
- `Local-Studio-manifest.json` matches the tag
- the asset's SHA-256 matches GitHub's digest

A platform answers 503 until a release containing its asset exists.
