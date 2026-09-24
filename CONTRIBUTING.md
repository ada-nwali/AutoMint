# Contributing to AutoMint

Thank you for contributing to AutoMint! This codebase is built through open-source GitHub Issues scoped to specific features, components, and contracts.

---

## Workflow

1. **Find an Issue**: Look for unassigned issues using repository labels:
   - **Area**: `area:contract`, `area:frontend`, `area:docs`, `area:ci`, `area:setup`
   - **Contract**: `contract:registry`, `contract:bot_nft`, `contract:accrual`, `contract:marketplace`, `contract:token`
   - **Type**: `type:bug`, `type:feature`, `type:security`, `type:refactor`, `type:docs`
   - **Difficulty**: `difficulty:easy`, `difficulty:medium`, `difficulty:hard`

2. **Claim the Issue**: Comment `"I'll take this"` on the issue and wait for it to be assigned to you before starting work.

3. **Branch from `main`**:

   ```bash
   git checkout main
   git pull origin main
   git checkout -b <issue-number>-<short-description>
   ```

4. **Implement Scoped Changes**: Implement **only** what the issue describes. Keep your PR focused and small. If you discover unrelated bugs or improvements, open a separate issue.

5. **Architecture Decision Records (ADRs)**: For changes affecting cross-contract architecture, storage layout, or auth logic, add or update an ADR under `docs/adr/`.

6. **Local Verification**:
   Run the full verification suite locally before opening a pull request:

   ```bash
   # Rust Smart Contracts - Test Suite
   cargo test --workspace

   # Rust Smart Contracts - Format Check
   cargo fmt --check --all

   # Rust Smart Contracts - Linter
   cargo clippy --all-targets --all-features -- -D warnings

   # Frontend Unit & Component Tests
   cd frontend && npm test

   # TypeScript Type Checking
   cd frontend && npm run type-check

   # Frontend Linting
   cd frontend && npm run lint
   ```

7. **Dependency Management**:
   AutoMint pins `soroban-sdk` to an exact patch version and disables its default
   features so production wasm stays lean and reproducible — see
   `docs/DEPENDENCIES.md`. 
   
   > **Note**: We also pin `stellar-cli` to version `21.4.0`. Install it exactly via:
   > `cargo install --locked stellar-cli --version 21.4.0 --features opt`
   
   Before bumping any dependency, review the diff:

   ```bash
   make deps-check    # `cargo update --dry-run` — prints bumps without touching Cargo.lock
   ```

   The `dependency-check` CI workflow runs this dry-run on every PR and uploads
   the result as an artifact, so silent version bumps never land unreviewed.
   After a reviewed bump, re-record each contract's `wasm_hash` in the deployment
   manifest (`deployments/<network>.json`).

8. **Submit Pull Request**:
   Open a PR **targeting the `main` branch**. Title it after the issue and include `Closes #<issue-number>` in the PR description.

---

## Pre-Commit Hook

Enable the repository pre-commit hook to catch formatting and lint issues automatically:

```bash
git config core.hooksPath .githooks
```

---

## Code Style & Enforcement Mechanisms

| Rule                        | Area       | Enforcement Mechanism                                                   |
| --------------------------- | ---------- | ----------------------------------------------------------------------- |
| Code Formatting (`rustfmt`) | Rust       | **Machine-enforced in CI** (`cargo fmt --check`)                        |
| Compiler Lints              | Rust       | **Machine-enforced in CI** (`cargo clippy -- -D warnings`)              |
| No Panics on User Input     | Rust       | **Review-only** _(Automated clippy lint enforcement landing in AM-223)_ |
| Static Type Safety          | TypeScript | **Machine-enforced in CI** (`npm run type-check`)                       |
| Code Linting                | TypeScript | **Machine-enforced in CI** (`npm run lint`)                             |
| No `any` Types              | TypeScript | **Review-only** _(ESLint rule enforcement landing in AM-223)_           |

---

## Questions & Assistance

If an issue's requirements or scope are unclear, leave a question directly in the issue thread.
