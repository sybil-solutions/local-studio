# Product site

The landing page is static HTML, CSS, and JavaScript with no build step or
external runtime dependencies.

Run `python3 -m http.server --directory site 8000` for a local preview.

Pushes to `main` deploy `site/` to GitHub Pages. The macOS button targets the
stable `Local-Studio-arm64.dmg` asset on the latest GitHub release; Windows and
Linux link to the releases page until installers ship.
