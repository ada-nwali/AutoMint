## Description

Brief summary of the changes introduced by this pull request.

Closes #<!-- issue number -->

---

## PR Type

- [ ] Bug fix (`type:bug`)
- [ ] New feature (`type:feature`)
- [ ] Smart contract change (`area:contract`)
- [ ] Frontend enhancement (`area:frontend`)
- [ ] Documentation update (`area:docs`)
- [ ] Refactoring / Infrastructure (`area:ci`, `area:setup`)

---

## Contributor Checklist

Please verify each of the following before submitting:

- [ ] **Target Branch**: This PR targets the `testnet-implementation` branch (not `main`).
- [ ] **Linked Issue**: The PR description includes `Closes #<issue-number>` referencing an assigned issue.
- [ ] **Local Verification**:
  - [ ] Smart contracts test suite passes: `cargo test --workspace`
  - [ ] Smart contracts format check passes: `cargo fmt --check --all`
  - [ ] Smart contracts linter passes: `cargo clippy --all-targets --all-features -- -D warnings`
  - [ ] Frontend tests pass: `cd frontend && npm test`
  - [ ] TypeScript check passes: `cd frontend && npm run type-check`
  - [ ] Linting passes: `cd frontend && npm run lint`
- [ ] **Contract Behaviour Changed**:
  - [ ] No (pure frontend/docs/ci change)
  - [ ] Yes (explain changes and any storage layout, event, or interface updates below)

---

### Contract Behaviour Changes (if applicable)

_If this PR modifies Rust smart contracts, detail state, auth, or interface changes here:_

---

### Deployment Notes (if applicable)

_If this PR requires testnet deployment steps, migration scripts, or configuration changes, document them here:_
