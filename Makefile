# Makefile — routine maintenance helpers for the AutoMint Cargo workspace.
# The canonical "what would `cargo update` change" entry point lives here so a
# maintainer can reproduce the CI dependency-drift check locally:
#
#   make deps-check    # `cargo update --dry-run` (touches nothing)
#   make deps-upgrade  # `cargo update`         (apply after review)
#
# See docs/DEPENDENCIES.md for the full policy (exact SDK pin, why
# `default-features = false`, where `testutils` is enabled).

.DEFAULT_GOAL := help

.PHONY: help deps-check deps-upgrade fmt clippy test contracts-build

help: ## Show available targets.
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make <target>\n\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*?## / { printf "  %-16s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

deps-check: ## Review what `cargo update` would change WITHOUT touching Cargo.lock.
	cargo update --dry-run

deps-upgrade: ## Apply dependency updates after reviewing `make deps-check`.
	cargo update

fmt: ## Format all Rust sources.
	cargo fmt --all

clippy: ## Run clippy across the workspace (CI uses the same invocation).
	cargo clippy --workspace -- -D warnings

test: ## Run the full Rust test suite.
	cargo test --workspace

coverage: ## Generate LLVM-cov lcov report for all contract crates.
	@command -v cargo-llvm-cov >/dev/null 2>&1 || { echo "cargo-llvm-cov not installed. Install with: cargo install cargo-llvm-cov"; exit 1; }
	cargo llvm-cov --workspace --lcov --output-path lcov.info
	@echo "Coverage report written to lcov.info"
	@command -v lcov >/dev/null 2>&1 && lcov --summary lcov.info || true

coverage-html: ## Generate LLVM-cov HTML report for all contract crates.
	@command -v cargo-llvm-cov >/dev/null 2>&1 || { echo "cargo-llvm-cov not installed. Install with: cargo install cargo-llvm-cov"; exit 1; }
	cargo llvm-cov --workspace --html
	@echo "HTML report written to target/llvm-cov/html/index.html"

contracts-build: ## Build all contract wasm (delegates to the Soroban CLI).
	stellar contract build