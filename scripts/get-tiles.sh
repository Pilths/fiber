#!/bin/sh
# Download the Malaysia basemap (PMTiles, zoom 0-14) into web/public/map/.
# Run once per machine that has internet (personal laptop, dev VM, prod VM).
# Optional: BUILD=YYYYMMDD picks a Protomaps daily build (default: yesterday, UTC).
set -eu
cd "$(dirname "$0")/.."
BUILD="${BUILD:-$(date -u -d yesterday +%Y%m%d)}"
mkdir -p web/public/map
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/web/public/map:/out" protomaps/go-pmtiles:v1.31.2 \
  extract "https://build.protomaps.com/$BUILD.pmtiles" /out/malaysia.pmtiles \
  --bbox=99.5,0.8,119.5,7.5 --maxzoom=14
ls -lh web/public/map/malaysia.pmtiles
