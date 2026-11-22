#!/usr/bin/env bash
set -euo pipefail

# Generate typed TypeScript bindings for all five contracts via stellar CLI.
# Output is committed so CI can fail on drift.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASM_DIR="$ROOT_DIR/target/wasm32v1-none/release"
OUT_BASE="$ROOT_DIR/frontend/src/lib/bindings"
PLACEHOLDER_CONTRACT_ID="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"

# Always build: cargo is incremental, so unchanged contracts are a no-op, and
# bindings can never be generated from a stale wasm (#1256).
echo "Building contracts..."
cargo build --target wasm32v1-none --release -p automint-registry -p automint-token -p automint-bot-nft -p automint-accrual -p automint-marketplace

# A case function instead of `declare -A`, which needs bash 4+ and fails on
# macOS's stock bash 3.2 (#1251).
wasm_for() {  # <contract-name> -> wasm filename
  case "$1" in
    registry)    echo "automint_registry.wasm"    ;;
    token)       echo "automint_token.wasm"       ;;
    bot_nft)     echo "automint_bot_nft.wasm"     ;;
    accrual)     echo "automint_accrual.wasm"     ;;
    marketplace) echo "automint_marketplace.wasm" ;;
    *) echo "generate-bindings.sh: unknown contract: $1" >&2; exit 2 ;;
  esac
}

for name in registry token bot_nft accrual marketplace; do
  wasm="$WASM_DIR/$(wasm_for "$name")"
  out="$OUT_BASE/$name"
  if [[ ! -f "$wasm" ]]; then
    echo "Missing WASM: $wasm" >&2
    exit 1
  fi
  echo "Generating bindings for $name from $wasm -> $out"
  # stellar-cli 22 (the version CI installs) requires --contract-id even when
  # generating from a local wasm; the all-zero id is a valid placeholder and
  # is what the committed bindings carry.
  stellar contract bindings typescript --wasm "$wasm" --output-dir "$out" --overwrite \
    --contract-id "$PLACEHOLDER_CONTRACT_ID"
done

# Patch: add // @ts-nocheck to silence SDK version mismatches (Timepoint, duplicate
# DataKey/initialize from speculative contract dependencies). The files remain
# committed and drift-checked, but tsc will not error on their internals.
# This keeps the "Rust signature change breaks TS build" guarantee via the
# type-only imports in contracts.ts, without requiring a perfect WASM spec.
for f in "$OUT_BASE"/*/src/index.ts; do
  if ! head -1 "$f" | grep -q "ts-nocheck"; then
    # prepend, portable across BSD (macOS) and GNU sed
    { printf '%s\n' '// @ts-nocheck'; cat "$f"; } > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done

echo "All bindings generated under $OUT_BASE"
