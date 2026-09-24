#!/usr/bin/env bash
#
# scripts/deploy.sh — build, deploy, and initialize all AutoMint contracts to a
# Soroban network, recording results in a crash-resilient manifest.
#
# This script is idempotent and resumable. Every contract's contract ID, wasm
# hash (sha256), git commit SHA, and initialization flag are written to
# `deployments/<network>.json` *immediately* after the corresponding step
# succeeds — never batched at the end. A crash mid-run therefore loses nothing:
# re-running resumes from the next step, skipping contracts already recorded,
# instead of orphaning a half-deployed set of contracts.
#
# The manifest schema is shared with scripts/verify-deployment.sh (#559): each
# contract records contract_id, initialized, wasm_hash, wasm_path, and git_sha.
#
# Usage:
#   ./scripts/deploy.sh [--network NET] [--identity ID] [--force] [--dry-run]
#                       [--wasm-dir DIR] [<network>] [<identity>]
#
# Flags:
#   --network NET   Soroban network alias (default: testnet)
#   --identity ID   Stellar key identity to use as source (default: mykey)
#   --force         Re-deploy AND re-initialize every contract even if the
#                   manifest already records them (full redeploy).
#   --dry-run       Print every action that would be taken and exit 0 WITHOUT
#                   deploying, invoking, building, or writing anything.
#   --wasm-dir DIR  Directory holding the built contract wasm
#                   (default: target/wasm32-unknown-unknown/release)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Defaults ────────────────────────────────────────────────────────────────
NETWORK="testnet"
IDENTITY="mykey"
FORCE=false
DRY_RUN=false
WASM_DIR="target/wasm32-unknown-unknown/release"

# ── Argument parsing (flags, with legacy positional network/identity fallback)
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)   NETWORK="$2";   shift 2 ;;
    --identity)  IDENTITY="$2";  shift 2 ;;
    --wasm-dir)  WASM_DIR="$2";  shift 2 ;;
    --force)     FORCE=true;     shift   ;;
    --dry-run)   DRY_RUN=true;   shift   ;;
    --help|-h)
      sed -n '2,30p' "${BASH_SOURCE[0]}"
      exit 0 ;;
    --*)
      echo "deploy.sh: unknown option: $1" >&2
      exit 2 ;;
    *)
      POSITIONAL+=("$1")
      shift ;;
  esac
done
# Backwards-compatible form: ./scripts/deploy.sh testnet mykey
if [[ ${#POSITIONAL[@]} -ge 1 ]]; then NETWORK="${POSITIONAL[0]}"; fi
if [[ ${#POSITIONAL[@]} -ge 2 ]]; then IDENTITY="${POSITIONAL[1]}"; fi

MANIFEST_DIR="$REPO_ROOT/deployments"
MANIFEST="$MANIFEST_DIR/$NETWORK.json"
# Registry → bot_nft → accrual → marketplace → token. bot_nft needs the registry
# id; marketplace needs the bot_nft id. accrual/token are independent.
CONTRACT_NAMES=(registry bot_nft accrual marketplace token)

# Locate a compiled wasm across possible stellar-cli build targets
# (wasm32v1-none for newer stellar-cli, wasm32-unknown-unknown, or a find
# fallback over the target dir). Mirrors upstream PR #585.
resolve_wasm() {  # <base-name-without-extension> -> prints wasm path
  local name="$1"
  if [[ -f "target/wasm32v1-none/release/${name}.wasm" ]]; then
    printf 'target/wasm32v1-none/release/%s.wasm\n' "$name"
  elif [[ -f "target/wasm32-unknown-unknown/release/${name}.wasm" ]]; then
    printf 'target/wasm32-unknown-unknown/release/%s.wasm\n' "$name"
  else
    local found
    found="$(find target -name "${name}.wasm" -path '*release*' 2>/dev/null | head -n 1 || true)"
    if [[ -n "$found" ]]; then printf '%s\n' "$found"; fi
  fi
}

# ── Helpers ─────────────────────────────────────────────────────────────────
log()  { printf '\n[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
ts()   { date -u +%Y-%m-%dT%H:%M:%SZ; }

manifest_exists() { [[ -f "$MANIFEST" ]]; }

manifest_get() {  # <contract> <field>  -> prints value (or empty if absent)
  manifest_exists || return 0
  jq -r --arg c "$1" --arg f "$2" '.contracts[$c][$f] // empty' "$MANIFEST" 2>/dev/null
}

# Write a string field for a contract.
manifest_set() {  # <contract> <field> <value>
  mkdir -p "$MANIFEST_DIR"
  local tmp; tmp="$(mktemp)"
  jq --arg c "$1" --arg f "$2" --arg v "$3" '.contracts[$c][$f] = $v' "$MANIFEST" > "$tmp"
  mv "$tmp" "$MANIFEST"
}

# Write a JSON-native (boolean/number) field for a contract.
manifest_set_json() {  # <contract> <field> <json>
  mkdir -p "$MANIFEST_DIR"
  local tmp; tmp="$(mktemp)"
  jq --arg c "$1" --arg f "$2" --argjson v "$3" '.contracts[$c][$f] = $v' "$MANIFEST" > "$tmp"
  mv "$tmp" "$MANIFEST"
}

manifest_touch_meta() {  # refresh git_sha + network + updated_at on the manifest
  manifest_exists || return 0
  local tmp; tmp="$(mktemp)"
  jq --arg net "$NETWORK" --arg sha "$GIT_SHA" --arg t "$(ts)" \
    '.network=$net | .git_sha=$sha | .updated_at=$t' "$MANIFEST" > "$tmp"
  mv "$tmp" "$MANIFEST"
}

init_manifest() {
  $DRY_RUN && return 0   # never create/rewrite files in dry-run mode
  if ! manifest_exists; then
    mkdir -p "$MANIFEST_DIR"
    jq -n --arg net "$NETWORK" --arg sha "$GIT_SHA" --arg t "$(ts)" \
      '{network:$net, git_sha:$sha, toolchain:"1.95.0",
        created_at:$t, updated_at:$t, contracts:{}}' > "$MANIFEST"
    log "Created manifest $MANIFEST"
  fi
  manifest_touch_meta
}

wasm_for() {  # <contract-name> -> wasm filename
  case "$1" in
    registry)   echo "automint_registry.wasm"   ;;
    bot_nft)    echo "automint_bot_nft.wasm"    ;;
    accrual)    echo "automint_accrual.wasm"    ;;
    marketplace) echo "automint_marketplace.wasm";;
    token)      echo "automint_token.wasm"      ;;
    *) echo "deploy.sh: unknown contract: $1" >&2; exit 2 ;;
  esac
}

get_git_sha() { git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown"; }

wasm_sha256() { sha256sum "$1" | awk '{print $1}'; }

# Soroban contract addresses are StrKey (type CONTRACT): a "C" prefix followed
# by 55 base32 chars (alphabet A-Z2-7) for 56 chars total. We validate that the
# `stellar contract deploy` output contains exactly such an address, so a
# malformed/partial/truncated result can never be written to the manifest. We
# accept the uppercase-alphanumeric superset ([A-Z0-9]) for the tail so every
# real address validates while empty / lowercase / hex / wrong-length output is
# rejected before it poisons the manifest.
validate_contract_id() {  # <id>
  local id="$1"
  if [[ ! "$id" =~ ^C[A-Z0-9]{55}$ ]]; then
    echo "ERROR: not a valid Soroban contract address: '$id'" >&2
    exit 1
  fi
}

extract_contract_id() {  # <raw stellar deploy output>
  grep -Eo 'C[A-Z0-9]{55}' <<<"$1" | head -1 || true
}

# Resolve a *dependency* contract id from the manifest. Dies if a required
# dependency was never recorded (e.g. a prior crash skipped its deploy).
resolve_id() {  # <contract-name>
  local id
  id="$(manifest_get "$1" contract_id)"
  if [[ -z "$id" ]]; then
    echo "ERROR: dependency contract '$1' is not deployed yet (no contract_id in manifest)." >&2
    exit 1
  fi
  printf '%s' "$id"
}

# ── Per-contract deploy + initialize ─────────────────────────────────────────
deploy_contract() {  # <name>
  local name="$1"
  local wname wname_base wasm_path existing_id
  wname="$(wasm_for "$name")"
  wname_base="${wname%.wasm}"
  wasm_path="$WASM_DIR/$wname"
  existing_id="$(manifest_get "$name" contract_id)"

  if $DRY_RUN; then
    printf '  [dry-run] would deploy %-10s from %s\n' "$name" "$wasm_path"
    return 0
  fi

  if [[ -n "$existing_id" && "$FORCE" == false ]]; then
    log "$name already deployed ($existing_id) — skipping (use --force to redeploy)"
    return 0
  fi

  # Fall back to resolve_wasm() when the wasm is not in --wasm-dir (e.g. the
  # stellar-cli produced wasm32v1-none output).
  if [[ ! -f "$wasm_path" ]]; then
    local resolved
    resolved="$(resolve_wasm "$wname_base")"
    if [[ -n "$resolved" && -f "$resolved" ]]; then
      wasm_path="$resolved"
    else
      echo "ERROR: wasm not found at $wasm_path — run 'stellar contract build' first." >&2
      exit 1
    fi
  fi

  log "Deploying $name ..."
  local raw id
  raw="$(stellar contract deploy \
        --wasm "$wasm_path" \
        --source "$IDENTITY" \
        --network "$NETWORK")"
  id="$(extract_contract_id "$raw")"
  validate_contract_id "$id"
  log "$name deployed: $id"

  # Record IMMEDIATELY so a crash after this point can never lose the id.
  manifest_set "$name" contract_id  "$id"
  manifest_set "$name" wasm_path    "$wasm_path"
  manifest_set "$name" wasm_hash    "$(wasm_sha256 "$wasm_path")"
  manifest_set "$name" git_sha      "$GIT_SHA"
  manifest_set "$name" deployed_at   "$(ts)"
  manifest_set_json "$name" initialized false
  manifest_touch_meta
}

init_contract() {  # <name> <init-fn> <init-args...>
  local name="$1"; local init_fn="$2"; shift 2
  local -a init_args=("$@")

  if $DRY_RUN; then
    printf '  [dry-run] would initialize %-10s (fn: %s %s)\n' \
      "$name" "$init_fn" "${init_args[*]:-}"
    return 0
  fi

  local already_init
  already_init="$(manifest_get "$name" initialized)"
  if [[ "$already_init" == "true" && "$FORCE" == false ]]; then
    log "$name already initialized — skipping (use --force to re-initialize)"
    return 0
  fi

  local id
  id="$(manifest_get "$name" contract_id)"
  if [[ -z "$id" ]]; then
    echo "ERROR: cannot init $name — no contract_id recorded for it." >&2
    exit 1
  fi

  log "Initializing $name ..."
  # shellcheck disable=SC2086
  stellar contract invoke \
    --id "$id" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- "$init_fn" "${init_args[@]}"

  manifest_set_json "$name" initialized true
  manifest_set "$name" initialized_at "$(ts)"
  manifest_touch_meta
  log "$name initialized."
}

# Read back a contract's `admin` after init to confirm initialization actually
# took effect (mirrors upstream PR #585's verification steps). Non-fatal.
verify_contract() {  # <name>
  local name="$1"
  local id
  id="$(manifest_get "$name" contract_id)"
  [[ -z "$id" ]] && return 0

  if $DRY_RUN; then
    printf '  [dry-run] would verify %-10s (read admin)\n' "$name"
    return 0
  fi

  local admin_addr
  admin_addr="$(stellar contract invoke --id "$id" --source "$IDENTITY" --network "$NETWORK" -- admin 2>/dev/null || true)"
  if [[ -n "$admin_addr" ]]; then
    log "$name verified (admin: $admin_addr)"
  else
    log "WARNING: could not verify $name admin — is it initialized?"
  fi
}

# Wire the Accrual contract as the Token's admin so claims can mint AMT
# (upstream PR #585). Idempotent: skips when the token admin already equals the
# accrual contract; --force re-wires.
wire_token_admin() {
  if $DRY_RUN; then
    log "[dry-run] would set token admin -> accrual"
    return 0
  fi

  local token_id accrual_id current
  token_id="$(manifest_get token contract_id)"
  accrual_id="$(manifest_get accrual contract_id)"
  if [[ -z "$token_id" || -z "$accrual_id" ]]; then
    log "WARNING: token/accrual not both deployed — skipping admin wiring"
    return 0
  fi

  if [[ "$FORCE" != true ]]; then
    current="$(stellar contract invoke --id "$token_id" --source "$IDENTITY" --network "$NETWORK" -- admin 2>/dev/null || true)"
    if [[ "$current" == "$accrual_id" ]]; then
      log "token admin already wired to accrual — skipping"
      return 0
    fi
  fi

  log "Wiring token admin -> accrual ($accrual_id) ..."
  # shellcheck disable=SC2086
  stellar contract invoke \
    --id "$token_id" \
    --source "$IDENTITY" \
    --network "$NETWORK" \
    -- set_admin --new_admin "$accrual_id"
  manifest_set token admin_wired_to "accrual"
  manifest_touch_meta
  log "Token admin wired to accrual."
}

write_env_local() {
  $DRY_RUN && { log "[dry-run] would update frontend/.env.local"; return 0; }
  log "Writing contract IDs to frontend/.env.local ..."

  local envf="$REPO_ROOT/frontend/.env.local"
  if [[ ! -f "$envf" ]]; then
    if [[ -f "$REPO_ROOT/frontend/.env.example" ]]; then
      cp "$REPO_ROOT/frontend/.env.example" "$envf"
    else
      : > "$envf"
    fi
  fi

  update_env_var() {  # <key> <value>
    local key=$1 value=$2
    if grep -q "^${key}=" "$envf"; then
      sed -i "s|^${key}=.*|${key}=${value}|g" "$envf"
    else
      echo "${key}=${value}" >> "$envf"
    fi
  }

  update_env_var NEXT_PUBLIC_NETWORK              "TESTNET"
  update_env_var NEXT_PUBLIC_SOROBAN_RPC_URL      "https://soroban-testnet.stellar.org"
  update_env_var NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE "\"Test SDF Network ; September 2015\""
  update_env_var NEXT_PUBLIC_REGISTRY_CONTRACT_ID      "$(manifest_get registry contract_id)"
  update_env_var NEXT_PUBLIC_BOT_NFT_CONTRACT_ID       "$(manifest_get bot_nft contract_id)"
  update_env_var NEXT_PUBLIC_ACCRUAL_CONTRACT_ID        "$(manifest_get accrual contract_id)"
  update_env_var NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID    "$(manifest_get marketplace contract_id)"
  update_env_var NEXT_PUBLIC_TOKEN_CONTRACT_ID          "$(manifest_get token contract_id)"
  log "Wrote $envf"
}

# ── Main ────────────────────────────────────────────────────────────────────
GIT_SHA="$(get_git_sha)"

log "AutoMint deploy | network=$NETWORK identity=$IDENTITY force=$FORCE dry-run=$DRY_RUN"

if $DRY_RUN; then
  log "DRY RUN — nothing will be deployed, invoked, built, or written."
fi

# 1. Build all contract wasm (prerequisite for deploy + hashing). Skipped in
#    dry-run; nothing to hash without a build.
if $DRY_RUN; then
  log "[dry-run] would run: stellar contract build"
else
  log "Building all contracts ..."
  stellar contract build
fi

# 2. Resolve the administrative address for the deploying identity.
if $DRY_RUN; then
  ADMIN_ADDRESS="<admin-address>"
else
  ADMIN_ADDRESS="$(stellar keys address "$IDENTITY")"
fi
log "Admin address: $ADMIN_ADDRESS"

init_manifest

# 3. Deploy + initialize each contract in dependency order. Each deploy writes
#    its record to the manifest *before* the matching init runs, so a crash
#    right after a successful deploy is recoverable by simply re-running.
#    After each init we read back `admin` to confirm it took effect (upstream
#    PR #585).
deploy_contract registry
init_contract registry initialize --admin "$ADMIN_ADDRESS"
verify_contract registry

deploy_contract bot_nft
init_contract bot_nft initialize --admin "$ADMIN_ADDRESS" --registry "$(resolve_id registry)"
verify_contract bot_nft

deploy_contract accrual
init_contract accrual initialize --admin "$ADMIN_ADDRESS" --points_per_amt 100
verify_contract accrual

deploy_contract marketplace
init_contract marketplace initialize --admin "$ADMIN_ADDRESS" \
  --bot-nft "$(resolve_id bot_nft)" --fee-bps 250
verify_contract marketplace

deploy_contract token
init_contract token initialize --admin "$ADMIN_ADDRESS" \
  --decimal 7 --name "AutoMint Token" --symbol "AMT"
verify_contract token

# 3b. Wire the Accrual contract as the Token's admin so claims can mint AMT.
wire_token_admin

# 4. Refresh frontend env from the manifest (resumed runs re-sync .env.local).
write_env_local

log "Deployment complete. Manifest: $MANIFEST"
