#!/usr/bin/env bash
#
# scripts/verify-deployment.sh — reproducible-build verifier for issue #559.
#
# For each contract recorded in `deployments/<network>.json`, this script:
#   1. checks out the manifest's `git_sha` into a throwaway git worktree,
#   2. builds that contract's wasm with the pinned toolchain (rust-toolchain.toml)
#      TWICE, in two separate Cargo target directories, and
#   3. asserts BOTH rebuilt sha256 hashes equal the `wasm_hash` recorded in the
#      manifest (and therefore equal each other).
#
# Building twice in *separate* target directories is what makes the acceptance
# criterion — "two builds of the same commit produce byte-identical wasm hashes" —
# directly checkable. A cached/noop build would trivially match, so we never
# reuse a target directory.
#
# Usage:
#   ./scripts/verify-deployment.sh <network>                # verify all contracts
#   ./scripts/verify-deployment.sh testnet --contract token # verify only token
# Options:
#   --network NET     Network whose manifest to verify (default: testnet).
#   --contract NAME   Verify only NAME (one of: registry bot_nft accrual
#                     marketplace token). Repeatable.
#   --toolchain CH    Override the toolchain (default: rust-toolchain.toml).
#   --no-clean        Leave worktrees / target dirs under /tmp for debugging.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

NETWORK="testnet"
CLEAN=true
TOOLCHAIN=""
CONTRACTS=()
declare -A WANT_CONTRACT=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)   NETWORK="$2";    shift 2 ;;
    --contract)  WANT_CONTRACT["$2"]=1; shift 2 ;;
    --toolchain) TOOLCHAIN="$2";   shift 2 ;;
    --no-clean)  CLEAN=false;      shift   ;;
    --help|-h)   sed -n '2,28p' "${BASH_SOURCE[0]}"; exit 0 ;;
    --*) echo "verify-deployment.sh: unknown option: $1" >&2; exit 2 ;;
    *)   NETWORK="$1"; shift ;;
  esac
done

MANIFEST="deployments/$NETWORK.json"
GIT_SHA="$(jq -r '.git_sha // empty' "$MANIFEST" 2>/dev/null || true)"

if [[ -z "$GIT_SHA" || "$GIT_SHA" == "null" ]]; then
  echo "ERROR: manifest $MANIFEST is missing a git_sha. Run ./scripts/deploy.sh $NETWORK first." >&2
  exit 1
fi
[[ -f "$MANIFEST" ]] || { echo "ERROR: no manifest $MANIFEST" >&2; exit 1; }

if [[ -n "$TOOLCHAIN" ]]; then
  CARGO=(cargo "+$TOOLCHAIN")
else
  CARGO=(cargo)
fi

WASM_TARGET="wasm32-unknown-unknown"
ALL_CONTRACTS=(registry bot_nft accrual marketplace token)

pkg_and_wasm() {  # <name> -> echoes "<pkg> <wasm-file>"
  case "$1" in
    registry)   echo "automint-registry automint_registry.wasm"   ;;
    bot_nft)    echo "automint-bot-nft automint_bot_nft.wasm"     ;;
    accrual)    echo "automint-accrual automint_accrual.wasm"     ;;
    marketplace) echo "automint-marketplace automint_marketplace.wasm";;
    token)      echo "automint-token automint_token.wasm"         ;;
    *) echo "verify-deployment.sh: unknown contract: $1" >&2; exit 2 ;;
  esac
}

sha_of() { sha256sum "$1" | awk '{print $1}'; }

build_in() {  # <worktree-dir> <target-dir> <pkg> -> builds wasm
  ( cd "$1" && CARGO_TARGET_DIR="$2" "${CARGO[@]}" build -p "$3" \
      --target "$WASM_TARGET" --release --locked )
}

verify_one() {
  local name="$1" pkg wname
  read -r pkg wname <<<"$(pkg_and_wasm "$name")"

  local rec_hash
  rec_hash="$(jq -r --arg c "$name" '.contracts[$c].wasm_hash // empty' "$MANIFEST")"
  if [[ -z "$rec_hash" ]]; then
    echo "  $name: manifest has no wasm_hash (not deployed?) — SKIP"
    return 1
  fi

  local short="${GIT_SHA:0:10}"
  local wdir="/tmp/automint_vw_${name}_${short}"
  local dir_a="/tmp/automint_vb1_${name}_${short}"
  local dir_b="/tmp/automint_vb2_${name}_${short}"

  if $CLEAN; then
    git worktree remove --force "$wdir" 2>/dev/null || true
    rm -rf "$wdir" "$dir_a" "$dir_b"
  fi
  git worktree add --detach --quiet "$wdir" "$GIT_SHA"

  # The worktree checks out a committed SHA, which may predate
  # rust-toolchain.toml (or, during development, the file may not be committed
  # yet). Reproducible builds must use the CURRENT toolchain policy — that is
  # the toolchain the recorded `wasm_hash` was produced with (manifest
  # `toolchain` field). Copy the pin in when the worktree does not have it.
  if [[ ! -f "$wdir/rust-toolchain.toml" && -f "$REPO_ROOT/rust-toolchain.toml" ]]; then
    cp "$REPO_ROOT/rust-toolchain.toml" "$wdir/rust-toolchain.toml"
    echo "  (copied rust-toolchain.toml into the $short worktree)"
  fi

  echo "  $name ($pkg @ $short): building (x2) ..."
  build_in "$wdir" "$dir_a" "$pkg" >"/tmp/vb1_${name}.log" 2>&1
  build_in "$wdir" "$dir_b" "$pkg" >"/tmp/vb2_${name}.log" 2>&1

  local wasm_a="$dir_a/$WASM_TARGET/release/$wname"
  local wasm_b="$dir_b/$WASM_TARGET/release/$wname"
  local hash_a hash_b
  hash_a="$(sha_of "$wasm_a")"
  hash_b="$(sha_of "$wasm_b")"

  $CLEAN && { git worktree remove --force "$wdir" 2>/dev/null || true; rm -rf "$dir_a" "$dir_b"; }

  local status="OK"
  if [[ "$hash_a" != "$rec_hash" ]]; then status="MISMATCH(record)"; fi
  if [[ "$hash_b" != "$rec_hash" ]]; then status="MISMATCH(record)"; fi
  if [[ "$hash_a" != "$hash_b" ]];   then status="MISMATCH(each-other)"; fi

  echo "    recorded : $rec_hash"
  echo "    build  1 : $hash_a"
  echo "    build  2 : $hash_b"
  echo "    result   : $status"

  [[ "$status" == "OK" ]]
}

echo "Verifying manifest: $MANIFEST"
echo "git_sha: $GIT_SHA"
echo "toolchain: ${TOOLCHAIN:-<rust-toolchain.toml>}"

failures=0
for name in "${ALL_CONTRACTS[@]}"; do
  if [[ ${#WANT_CONTRACT[@]} -gt 0 && -z "${WANT_CONTRACT[$name]+x}" ]]; then
    continue
  fi
  if ! verify_one "$name"; then
    failures=$((failures + 1))
  fi
done

echo
if [[ $failures -eq 0 ]]; then
  echo "✅ All contracts verified: rebuilt wasm hashes match the manifest."
  exit 0
else
  echo "❌ $failures contract(s) failed verification."
  exit 1
fi
