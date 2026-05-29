#!/usr/bin/env bash
# scripts/wasm/build.sh
# Build DOSBox 0.74-3 WASM artifacts and copy them into public/wasm/.
#
# Usage:
#   ./scripts/wasm/build.sh           # Build using docker layer cache (1–2 min if cached)
#   ./scripts/wasm/build.sh --no-cache  # Force full rebuild (30–60 min)
#   ./scripts/wasm/build.sh --verify   # After build, compare SHA256 against expected-hashes.txt

set -euo pipefail

cd "$(dirname "$0")"  # scripts/wasm/
REPO_ROOT="$(cd ../.. && pwd)"
NO_CACHE=""
VERIFY=0
for arg in "$@"; do
  case "$arg" in
    --no-cache) NO_CACHE="--no-cache" ;;
    --verify)   VERIFY=1 ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# Preflight checks
if ! command -v docker >/dev/null; then
  echo "Error: docker not found. Install Docker Desktop."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Error: docker daemon not running."
  exit 1
fi
if [ ! -f dosbox-0.74-3.tar.gz ] || [ ! -f dosbox-0.74-3.tar.gz.sha256 ]; then
  echo "Error: vendored source missing. Run Task A1 first."
  exit 1
fi

# Verify tarball before Docker even starts
shasum -a 256 -c dosbox-0.74-3.tar.gz.sha256

IMAGE_TAG="dosbox-wasm-builder:latest"

echo "==> docker build (this can take 30-60 min cold, 1-2 min cached)"
docker build $NO_CACHE -t "$IMAGE_TAG" -f Dockerfile .

echo "==> extracting artifacts"
CID=$(docker create "$IMAGE_TAG")
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

mkdir -p "$REPO_ROOT/public/wasm"
docker cp "$CID:/build/dosbox-0.74-3/src/dosbox0743.wasm" "$REPO_ROOT/public/wasm/dosbox0743.wasm"
docker cp "$CID:/build/dosbox-0.74-3/src/dosbox0743.js"   "$REPO_ROOT/public/wasm/dosbox0743.js"
node "$REPO_ROOT/scripts/wasm/patch-loader.mjs" "$REPO_ROOT/public/wasm/dosbox0743.js"

# Sanity check artifact sizes
WASM_SIZE=$(stat -f%z "$REPO_ROOT/public/wasm/dosbox0743.wasm" 2>/dev/null || stat -c%s "$REPO_ROOT/public/wasm/dosbox0743.wasm")
if [ "$WASM_SIZE" -lt 800000 ]; then
  echo "Error: dosbox0743.wasm is suspiciously small ($WASM_SIZE bytes)"
  exit 1
fi
echo "==> dosbox0743.wasm: $WASM_SIZE bytes"

if [ "$VERIFY" -eq 1 ]; then
  echo "==> verifying against expected-hashes.txt"
  bash "$REPO_ROOT/scripts/wasm/verify-wasm.sh"
fi

echo "==> Done. Artifacts at public/wasm/"
