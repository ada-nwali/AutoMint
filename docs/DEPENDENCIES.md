# Dependency Policy

This document records the AutoMint workspace's policies for the Rust (and
system) dependencies used to build the smart contracts. It exists so that
version bumps never happen silently and so reviewers can confirm *why* each
feature flag is the way it is.

## Soroban SDK — exact patch pin

`Cargo.toml` (workspace root) declares:

```toml
soroban-sdk = { version = "=21.7.7", default-features = false }
```

The `=21.7.7` pin is **exact** (no leading `^`, no bare major/minor). Soroban SDK
patch releases have historically changed storage and auth semantics; a silent
`cargo update` bump could therefore move `Cargo.lock` to a newer `21.x` patch
and break the byte-identical-wasm guarantee required by the reproducible-build
checks (see `docs/DEPLOYMENT.md` → "Verifying a deployment") **without any code
change from the author of that bump**.

`Cargo.lock` records the single resolved version (`21.7.7`). To move to a new
SDK release, edit the pin in `Cargo.toml` (and the `[dev-dependencies]` of each
contract crate), run `make deps-upgrade`, then regenerate and re-record every
contract's `wasm_hash` in the deployment manifest.

## Why `default-features = false`

The workspace dependency disables the SDK's default feature set so production
contracts compile to the leanest possible wasm and never pull in test-only,
non-wasm-safe code paths.

The `testutils` feature (mock auth, ledger mocking, event capture) is **only**
enabled in test/dev resolution. It is surfaced through cargo features and
`[dev-dependencies]`, never through the production `[dependencies]` (which uses
`{ workspace = true }`):

| Crate                       | File                  | How `testutils` is enabled |
| --------------------------- | --------------------- | -------------------------- |
| `contracts/registry`        | `Cargo.toml`          | `[features] testutils = ["soroban-sdk/testutils"]` + `[dev-dependencies] soroban-sdk = { version = "=21.7.7", features = ["testutils"] }` |
| `contracts/bot_nft`         | `Cargo.toml`          | same |
| `contracts/accrual`         | `Cargo.toml`          | same |
| `contracts/marketplace`     | `Cargo.toml`          | same |
| `contracts/token`           | `Cargo.toml`          | same |
| `contracts/testutils`       | `Cargo.toml`          | same (this crate is itself only ever a `[dev-dependency]` of the five contracts above) |

Each contract also exposes its own `testutils` cargo feature
(`[features] testutils = ["soroban-sdk/testutils"]`), activated through the
dev-dependency. A per-contract production build (`stellar contract build`, or
`cargo build -p <contract> --target wasm32-unknown-unknown --release`, no
`--tests`/`--dev`) never enables `testutils`, so it cannot leak into a deployed
wasm.

> **Known caveat (pre-existing):** `contracts/testutils` (automint-testutils)
> enables `soroban-sdk/testutils` in its *regular* `[dependencies]` because it
> is itself only ever referenced as a `[dev-dependency]`. A full
> `cargo build --workspace --target wasm32-unknown-unknown` therefore unifies
> the `testutils` feature into the wasm build, and soroban-sdk aborts that
> build (`'testutils' feature is not supported on 'wasm' target`). This is a
> pre-existing workspace quirk, unrelated to the SDK pin — the supported
> production build path is per-contract (which is what `scripts/deploy.sh`,
> `scripts/verify-deployment.sh`, and CI use). `cargo build --workspace` (host
> target) and `cargo test --workspace` are unaffected.

## Routine maintenance

Use the repo `Makefile` (standard for a Cargo workspace):

```bash
make deps-check    # `cargo update --dry-run` — review bumps, touches nothing
make deps-upgrade  # `cargo update`           — apply after review
make fmt           # `cargo fmt --all`
make clippy        # CI-identical clippy gate
make test          # `cargo test --workspace`
```

`.github/workflows/dependency-check.yml` runs the dry-run on every PR and
uploads the diff as an artifact, so drift stays visible in CI. The CI job also
builds one contract wasm with the pinned toolchain to catch a toolchain/SDK
mismatch early.
