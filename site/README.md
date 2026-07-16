# Product site

The landing page is static HTML, CSS, and JavaScript with no build step or
external runtime dependencies.

Run `python3 -m http.server --directory site 8000` for a local preview.

Pushes to `main` deploy `site/` to GitHub Pages. The macOS button is pinned to
the signed `Local-Studio-arm64.dmg` asset on the v2.0.0 release so a later
release without desktop assets cannot break the public download. Windows and
Linux link to the releases page until installers ship.
