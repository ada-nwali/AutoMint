#!/usr/bin/env bash
# Fast pre-commit checks — a lightweight subset of the CI gates in
# .github/workflows/ci.yml, meant to run in well under 5 seconds on a
# typical changeset.
#
# Enable with:
#   git config core.hooksPath .githooks
# (see .githooks/pre-commit, which calls this script)

set -e

# #486: fail the commit if any .env* file other than .env.example is staged.
# .gitignore covers frontend/.env.local, but nothing stopped `git add -f`
# from publishing it (or any future non-public var added there).
"$(git rev-parse --show-toplevel)/scripts/check-env.sh"

changed_frontend=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^frontend/.*\.(ts|tsx)$' || true)
changed_rust=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.rs$' || true)

if [ -n "$changed_rust" ]; then
  echo "Running cargo fmt --check on staged Rust changes..."
  cargo fmt --all --check
fi

if [ -n "$changed_frontend" ]; then
  echo "Running tsc --noEmit on the frontend..."
  (cd frontend && npm run type-check)
fi
