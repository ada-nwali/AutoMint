#!/usr/bin/env bash
set -euo pipefail

# Generate typed TypeScript bindings for all five contracts via stellar CLI.
# WASM must exist (cargo build --target wasm32v1-none --release -p ...).
# Output is committed so CI can fail on drift.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASM_DIR="$ROOT_DIR/target/wasm32v1-none/release"
OUT_BASE="$ROOT_DIR/frontend/src/lib/bindings"

# Build WASM if not present
if [[ ! -f "$WASM_DIR/automint_registry.wasm" ]]; then
  echo "WASM not found, building contracts..."
  cargo build --target wasm32v1-none --release -p automint-registry -p automint-token -p automint-bot-nft -p automint-accrual -p automint-marketplace
fi

declare -A CONTRACTS=(
  ["registry"]="automint_registry.wasm"
  ["token"]="automint_token.wasm"
  ["bot_nft"]="automint_bot_nft.wasm"
  ["accrual"]="automint_accrual.wasm"
  ["marketplace"]="automint_marketplace.wasm"
)

for name in "${!CONTRACTS[@]}"; do
  wasm="$WASM_DIR/${CONTRACTS[$name]}"
  out="$OUT_BASE/$name"
  if [[ ! -f "$wasm" ]]; then
    echo "Missing WASM: $wasm" >&2
    exit 1
  fi
  echo "Generating bindings for $name from $wasm -> $out"
  stellar contract bindings typescript --wasm "$wasm" --output-dir "$out" --overwrite
done

# Patch: add // @ts-nocheck to silence SDK version mismatches (Timepoint, duplicate
# DataKey/initialize from speculative contract dependencies). The files remain
# committed and drift-checked, but tsc will not error on their internals.
# This keeps the "Rust signature change breaks TS build" guarantee via the
# type-only imports in contracts.ts, without requiring a perfect WASM spec.
for f in "$OUT_BASE"/*/src/index.ts; do
  if ! head -1 "$f" | grep -q "ts-nocheck"; then
    sed -i '1i// @ts-nocheck' "$f"
  fi
done

echo "All bindings generated under $OUT_BASE"
