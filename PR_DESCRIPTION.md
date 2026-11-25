## Description

Fixes four repo-hygiene issues: label source of truth, a security policy, and two Docker build problems.

Closes #1359
Closes #1360
Closes #1361
Closes #1362

### Changes

**#1359 – labels out of sync**
- `.github/labels.yml` is now the single source of truth, matching the labels the repo actually uses: `area:contracts`, `area:infra`, `type:perf`, `type:a11y`, `type:test` added; stale `area:contract`, `area:ci`, `area:setup`, `difficulty:easy` removed.
- New `.github/workflows/label-sync.yml` creates/updates labels on push to `testnet-implementation` (when `labels.yml` changes) or manually. It never deletes labels.
- Removed the stale `scripts/create-labels.sh`.
- Updated issue templates, PR template and `CONTRIBUTING.md` to the new label names.

**#1360 – SECURITY.md**
- Added `SECURITY.md`: private reporting via GitHub Security tab, response-time targets, scope (contracts, frontend, indexer), out-of-scope items, safe harbor.

**#1361 – Docker build fails on placeholder IDs**
- Removed the `CCXXXX…` defaults from `frontend/Dockerfile` and `docker-compose.yml`.
- Dockerfile now fails early with a clear message if a `NEXT_PUBLIC_*_CONTRACT_ID` build arg is missing; Compose uses `${VAR:?message}`.
- `docs/DEPLOYMENT.md` documents that real contract IDs are required.

**#1362 – invalid apk flag**
- `apk add --no-libc-compat libc6-compat` → `apk add --no-cache libc6-compat`.

---

## PR Type

- [ ] Bug fix (`type:bug`)
- [ ] New feature (`type:feature`)
- [ ] Smart contract change (`area:contracts`)
- [ ] Frontend enhancement (`area:frontend`)
- [x] Documentation update (`area:docs`)
- [x] Refactoring / Infrastructure (`area:infra`)

## Contributor Checklist

- [x] **Target Branch**: targets `testnet-implementation`
- [x] **Linked Issue**: `Closes` tags included for all four issues
- [x] **Local Verification**: no Rust or TypeScript code changed; YAML files validated
- [x] **Contract Behaviour Changed**: No (docs/CI/Docker only)

### Deployment Notes

- After merge, run the **Label Sync** workflow once (or it runs on the next `labels.yml` change) to create the new labels.
- Docker builds now require the five `NEXT_PUBLIC_*_CONTRACT_ID` values to be passed explicitly.
