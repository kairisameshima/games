#!/usr/bin/env bash
# Rebuild every game asset in src/assets from art/raw. Sizes are in game pixels; the world is 160 wide.
set -euo pipefail
cd "$(dirname "$0")/.."

process() { python3 tools/process-art.py "$@"; }

process backdrop surface 160
process backdrop cavern_far 160
process cutout cavern_mid 160
for zone in topsoil coal copper gold crystal; do process gallery "gallery_$zone" 134; done
process sheet kid 3 4 18
process sheet tools 2 3 20
process sheet props 2 3 26
