#!/bin/sh
# Download the map assets into web/public/map/ (git-ignored):
#   malaysia.pmtiles  Malaysia basemap (PMTiles, zoom 0-14) from a Protomaps daily build
#   fonts/Noto Sans Regular/*.pbf  label glyphs for the basemap style (the only font stack it uses)
# Run once per machine that has internet (personal laptop, dev VM, prod VM). The app never fetches these at runtime
# from the internet; without them the map still draws spans and sites on a plain background.
# Optional: BUILD=YYYYMMDD picks a Protomaps daily build (default: yesterday, UTC).
set -eu
cd "$(dirname "$0")/.."
BUILD="${BUILD:-$(date -u -d yesterday +%Y%m%d)}"
# protomaps/basemaps-assets, pinned commit (2025-10-31); fonts are SIL OFL (OFL.txt is copied next to them).
ASSETS_SHA=028c18f713baecad011301ff7a69acc39bcc2ae7
FONT="Noto Sans Regular"
mkdir -p web/public/map

if [ ! -s web/public/map/malaysia.pmtiles ] || [ "${FORCE:-}" = 1 ]; then
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/web/public/map:/out" protomaps/go-pmtiles:v1.31.2 \
    extract "https://build.protomaps.com/$BUILD.pmtiles" /out/malaysia.pmtiles \
    --bbox=99.5,0.8,119.5,7.5 --maxzoom=14
fi

if [ ! -s "web/public/map/fonts/$FONT/0-255.pbf" ] || [ "${FORCE:-}" = 1 ]; then
  tmp=$(mktemp -d)
  curl -fsSL "https://codeload.github.com/protomaps/basemaps-assets/tar.gz/$ASSETS_SHA" \
    | tar -xz -C "$tmp" "basemaps-assets-$ASSETS_SHA/fonts/$FONT" "basemaps-assets-$ASSETS_SHA/fonts/OFL.txt"
  mkdir -p web/public/map/fonts
  rm -rf "web/public/map/fonts/$FONT"
  mv "$tmp/basemaps-assets-$ASSETS_SHA/fonts/$FONT" "$tmp/basemaps-assets-$ASSETS_SHA/fonts/OFL.txt" web/public/map/fonts/
  rm -rf "$tmp"
fi

ls -lh web/public/map/malaysia.pmtiles
echo "glyphs: $(ls "web/public/map/fonts/$FONT" | wc -l) files in web/public/map/fonts/$FONT"
