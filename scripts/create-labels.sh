#!/usr/bin/env bash

# Shell script to create or update GitHub repository labels using gh CLI

set -e

REPO="${1:-Alaka-ibr/AutoMint}"

echo "Syncing repository labels for $REPO..."

labels=(
  "area:contract|0052cc|Issues and PRs related to Soroban smart contracts in contracts/"
  "area:frontend|1d76db|Issues and PRs related to the Next.js frontend application"
  "area:docs|0075ca|Issues and PRs related to project documentation and ADRs"
  "area:ci|5319e7|Issues and PRs related to GitHub Actions workflows and CI automation"
  "area:setup|bfd4f2|Issues and PRs related to repository configuration, toolchains, or scripts"
  "contract:registry|d4c5f9|Soroban User Profile & Leaderboard Registry Contract"
  "contract:bot_nft|d4c5f9|Soroban Bot NFT Minting & Tier Ownership Contract"
  "contract:accrual|d4c5f9|Soroban Point Accrual & Token Mint Redemption Contract"
  "contract:marketplace|d4c5f9|Soroban P2P Bot NFT Escrow Marketplace Contract"
  "contract:token|d4c5f9|Soroban SEP-41 AMT Token Contract"
  "type:bug|d93f0b|Something isn't working as expected"
  "type:feature|a2eeef|New feature or enhancement proposal"
  "type:security|b60205|Security vulnerability, smart contract invariant, or auth concern"
  "type:refactor|cfd3d7|Code refactoring or structural improvement without behavior change"
  "type:docs|0075ca|Documentation updates or corrections"
  "difficulty:easy|0e8a16|Good for first-time contributors or simple one-file fixes"
  "difficulty:medium|fbca04|Requires moderate codebase understanding"
  "difficulty:hard|d93f0b|Complex architectural or multi-contract changes"
)

for entry in "${labels[@]}"; do
  IFS="|" read -r name color description <<< "$entry"
  echo "Creating/Updating label: $name ($color)"
  if command -v gh &> /dev/null; then
    gh label create "$name" --color "$color" --description "$description" --repo "$REPO" --force || true
  else
    echo "  (gh CLI not installed, skipping API call for $name)"
  fi
done

echo "Label sync script completed."
