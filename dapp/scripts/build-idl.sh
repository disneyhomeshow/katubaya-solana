#!/bin/sh
# Rebuilds idl/farmer_core.json from the program source without the Anchor CLI.
# Same mechanism as `anchor idl build`: the idl-build feature prints the IDL from tests.
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$here/.." && pwd)
raw=$(mktemp)
cd "$repo"
ANCHOR_IDL_BUILD_RESOLUTION=TRUE \
ANCHOR_IDL_BUILD_PROGRAM_PATH="$repo/programs/farmer-core" \
ANCHOR_IDL_BUILD_SKIP_LINT=TRUE \
  cargo test -p farmer-core __anchor_private_print_idl --features idl-build -- --show-output --quiet > "$raw"
node "$here/scripts/assemble-idl.mjs" "$raw" "$here/idl/farmer_core.json"
rm -f "$raw"
