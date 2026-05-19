#!/usr/bin/env bash
# Verify that public/wasm/*.{wasm,js} match the expected hashes pinned in
# scripts/wasm/expected-hashes.txt.
#
# Format of expected-hashes.txt (one line per file):
#   <sha256>  public/wasm/wdosbox.wasm
#   <sha256>  public/wasm/wdosbox.js

set -euo pipefail
cd "$(dirname "$0")/../.."  # repo root

if [ ! -s scripts/wasm/expected-hashes.txt ]; then
  echo "Error: scripts/wasm/expected-hashes.txt is empty. Populate it via build.sh first."
  exit 1
fi

shasum -a 256 -c scripts/wasm/expected-hashes.txt
