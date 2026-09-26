#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

version="${LOCAL_STUDIO_VERSION:-$(bun -e 'console.log(require("./controller/package.json").version)')}"
targets="${LOCAL_STUDIO_TARGETS:-bun-linux-x64 bun-darwin-arm64}"

mkdir -p dist
bun run --cwd ui build >dist/build-ui.log 2>&1 || { cat dist/build-ui.log >&2; exit 1; }

for target in $targets; do
  pair="${target#bun-}"
  out="dist/$pair"
  rm -rf "$out"
  mkdir -p "$out"
  bun build controller/src/main.ts --compile --target="$target" \
    --define "process.env.LOCAL_STUDIO_VERSION=\"$version\"" \
    --outfile "$out/local-studio" >"dist/build-$pair.log" 2>&1 || { cat "dist/build-$pair.log" >&2; exit 1; }
  cp -R ui/dist "$out/ui"
  tarball="dist/local-studio-$version-$pair.tar.gz"
  COPYFILE_DISABLE=1 tar -czf "$tarball" -C "$out" local-studio ui
  printf '%s %s\n' "$root/$tarball" "$(du -h "$tarball" | cut -f1)"
done
