#!/usr/bin/env bash
# Build the combined Vercel output:
#   dist-vercel/         ← landing page (served at /)
#   dist-vercel/try/     ← web IDE (served at /try)
#
# This is the buildCommand for the root vercel.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[build-vercel] cleaning dist-vercel/"
rm -rf dist-vercel

echo "[build-vercel] building web IDE with base=/try/"
BUILD_TARGET=web npm run build:web

echo "[build-vercel] assembling output dir"
mkdir -p dist-vercel
# Copy only the static files we want — NOT dotfiles, package.json, or old vercel.json
cp landing/index.html dist-vercel/

# Copy web IDE build output into dist-vercel/try/
mkdir -p dist-vercel/try
cp -R dist-web/. dist-vercel/try/

echo "[build-vercel] contents:"
ls -la dist-vercel/ | head -20
echo "  try/:"
ls dist-vercel/try/ | head -20

echo "[build-vercel] done"
