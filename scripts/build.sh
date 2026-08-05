#!/usr/bin/env bash
# Packs the files Chrome actually loads into a zip a user can download and
# unzip. Tests, docs, and images stay out — they only make the download bigger
# and the unzipped folder more confusing to point "Load unpacked" at.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

version="$(node -p "require('./manifest.json').version")"
name="linkedin-learning-auto-resume-${version}"
out="dist/${name}.zip"

rm -rf "dist/${name}" "$out"
mkdir -p "dist/${name}"

cp manifest.json "dist/${name}/"
cp -R src "dist/${name}/"

( cd dist && zip -qr "${name}.zip" "${name}" )
rm -rf "dist/${name}"

echo "built $out ($(du -h "$out" | cut -f1))"
unzip -Z1 "$out" | sed 's/^/  /'
