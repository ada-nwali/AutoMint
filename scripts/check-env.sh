#!/usr/bin/env bash
# #486: fail if any .env* file other than .env.example is staged/changed.
#
# Local use (pre-commit, checks what's staged):
#   scripts/check-env.sh
#
# CI use (checks a diff range, e.g. against the PR's merge-base):
#   scripts/check-env.sh origin/main...HEAD

set -e

if [ -n "$1" ]; then
  changed=$(git diff --name-only --diff-filter=ACM "$1")
else
  changed=$(git diff --cached --name-only --diff-filter=ACM)
fi

env_files=$(echo "$changed" | grep -E '(^|/)\.env(\..+)?$' | grep -v '\.env\.example$' || true)

if [ -n "$env_files" ]; then
  echo "ERROR: .env file(s) other than .env.example found in this change:"
  echo "$env_files" | sed 's/^/  /'
  echo "These are meant to stay local — see .gitignore. Unstage/remove them before committing."
  exit 1
fi

echo "check:env passed — no .env files (other than .env.example) in this change."
