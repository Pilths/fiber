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
# Behind a TLS-inspecting proxy: trust certs/corporate-ca.crt (same file the Dockerfiles use) on top of the system CAs.
BUNDLE=/etc/ssl/certs/ca-certificates.crt
CA_ENV=""
if [ -f certs/corporate-ca.crt ]; then
  BUNDLE="$PWD/web/public/map/.ca-bundle.pem"
  cat /etc/ssl/certs/ca-certificates.crt certs/corporate-ca.crt > "$BUNDLE"
  CA_ENV="-e SSL_CERT_FILE=/out/.ca-bundle.pem"
  trap 'rm -f "$BUNDLE"' EXIT
fi

if [ ! -s web/public/map/malaysia.pmtiles ] || [ "${FORCE:-}" = 1 ]; then
  echo "Downloading Malaysia basemap from build $BUILD (about 220 MB, takes a few minutes)..."
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/web/public/map:/out" $CA_ENV \
    protomaps/go-pmtiles:v1.31.2 \
    extract "https://build.protomaps.com/$BUILD.pmtiles" /out/malaysia.pmtiles \
    --bbox=99.5,0.8,119.5,7.5 --maxzoom=14
fi

if [ ! -s "web/public/map/fonts/$FONT/0-255.pbf" ] || [ "${FORCE:-}" = 1 ]; then
  tmp=$(mktemp -d)
  curl -fsSL --cacert "$BUNDLE" "https://codeload.github.com/protomaps/basemaps-assets/tar.gz/$ASSETS_SHA" \
    | tar -xz -C "$tmp" "basemaps-assets-$ASSETS_SHA/fonts/$FONT" "basemaps-assets-$ASSETS_SHA/fonts/OFL.txt"
  mkdir -p web/public/map/fonts
  rm -rf "web/public/map/fonts/$FONT"
  mv "$tmp/basemaps-assets-$ASSETS_SHA/fonts/$FONT" "$tmp/basemaps-assets-$ASSETS_SHA/fonts/OFL.txt" web/public/map/fonts/
  rm -rf "$tmp"
fi

ls -lh web/public/map/malaysia.pmtiles
echo "glyphs: $(ls "web/public/map/fonts/$FONT" | wc -l) files in web/public/map/fonts/$FONT"
