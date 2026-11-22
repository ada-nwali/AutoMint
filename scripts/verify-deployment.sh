#!/usr/bin/env bash
#
# scripts/verify-deployment.sh — reproducible-build verifier for issue #559.
#
# For each contract recorded in `deployments/<network>.json`, this script:
#   1. checks out the manifest's `git_sha` into a throwaway git worktree,
#   2. runs the same `stellar contract build` command used by deploy.sh TWICE,
#      in two separate target directories, and
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
# Indexed array, not `declare -A`: bash 3.2 (stock macOS) has no associative
# arrays (#1251).
WANT_CONTRACTS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)   NETWORK="$2";    shift 2 ;;
    --contract)  WANT_CONTRACTS+=("$2"); shift 2 ;;
    --toolchain) TOOLCHAIN="$2";   shift 2 ;;
    --no-clean)  CLEAN=false;      shift   ;;
    --help|-h)   sed -n '2,28p' "${BASH_SOURCE[0]}"; exit 0 ;;
    --*) echo "verify-deployment.sh: unknown option: $1" >&2; exit 2 ;;
    *)   NETWORK="$1"; shift ;;
  esac
done

MANIFEST="deployments/$NETWORK.json"
[[ -f "$MANIFEST" ]] || { echo "ERROR: no manifest $MANIFEST" >&2; exit 1; }

GIT_SHA="$(jq -r '.git_sha // empty' "$MANIFEST" 2>/dev/null || true)"
if [[ -z "$GIT_SHA" || "$GIT_SHA" == "null" ]]; then
  echo "ERROR: manifest $MANIFEST is missing a git_sha. Run ./scripts/deploy.sh $NETWORK first." >&2
  exit 1
fi

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

is_wanted() {  # <name> -> success when no --contract filter was given or it names <name>
  # Guard the length first: under `set -u`, bash < 4.4 treats expanding an
  # empty array as an unbound variable.
  [[ ${#WANT_CONTRACTS[@]} -eq 0 ]] && return 0
  local want
  for want in "${WANT_CONTRACTS[@]}"; do
    [[ "$want" == "$1" ]] && return 0
  done
  return 1
}

sha_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "ERROR: neither sha256sum nor shasum -a 256 found" >&2
    exit 1
  fi
}

wasm_target_for() {  # <wasm-path> -> prints the Rust target directory, if known
  local path="$1"
  if [[ "$path" =~ (^|/)target/([^/]+)/release/ ]]; then
    printf '%s\n' "${BASH_REMATCH[2]}"
  fi
}

build_in() {  # <worktree-dir> <target-dir> -> builds wasm using deploy.sh's command
  if [[ -n "$TOOLCHAIN" ]]; then
    ( cd "$1" && RUSTUP_TOOLCHAIN="$TOOLCHAIN" CARGO_TARGET_DIR="$2" stellar contract build )
  else
    ( cd "$1" && CARGO_TARGET_DIR="$2" stellar contract build )
  fi
}

verify_one() {
  local name="$1" pkg wname
  read -r pkg wname <<<"$(pkg_and_wasm "$name")"

  local rec_hash wasm_target wasm_path
  rec_hash="$(jq -r --arg c "$name" '.contracts[$c].wasm_hash // empty' "$MANIFEST")"
  if [[ -z "$rec_hash" ]]; then
    echo "  $name: manifest has no wasm_hash (not deployed?) — SKIP"
    return 0
  fi
  wasm_target="$(jq -r --arg c "$name" '.contracts[$c].wasm_target // empty' "$MANIFEST")"
  if [[ -z "$wasm_target" ]]; then
    wasm_path="$(jq -r --arg c "$name" '.contracts[$c].wasm_path // empty' "$MANIFEST")"
    wasm_target="$(wasm_target_for "$wasm_path")"
  fi
  if [[ -z "$wasm_target" || ! "$wasm_target" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    echo "  $name: manifest has no usable wasm_target or target-bearing wasm_path — FAIL" >&2
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

  echo "  $name ($pkg @ $short, target $wasm_target): building (x2) ..."
  build_in "$wdir" "$dir_a" >"/tmp/vb1_${name}.log" 2>&1
  build_in "$wdir" "$dir_b" >"/tmp/vb2_${name}.log" 2>&1

  local wasm_a="$dir_a/$wasm_target/release/$wname"
  local wasm_b="$dir_b/$wasm_target/release/$wname"
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
  is_wanted "$name" || continue
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
