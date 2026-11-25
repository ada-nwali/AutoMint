# Security Policy

AutoMint is a Soroban smart-contract project that handles user funds and
NFTs. We take security reports seriously and appreciate responsible disclosure.

## Reporting a Vulnerability

**Please do not open a public issue, pull request, or discussion for security
vulnerabilities.**

Report privately using GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (or **Advisories → New draft security advisory**).
3. Describe the issue.

Please include:

- The affected component (contract, frontend, or indexer) and file/function if known.
- Steps to reproduce or a proof of concept (a failing `cargo test` is ideal for contracts).
- The impact you expect (e.g. loss of funds, unauthorized minting, denial of service).
- Any suggested fix or mitigation.

If private reporting is unavailable, contact the maintainers listed in
[`.github/CODEOWNERS`](.github/CODEOWNERS) through their GitHub profile and ask
for a private channel, without including vulnerability details in the first message.

## Response Times

| Stage | Target |
| --- | --- |
| Acknowledgement of your report | within 3 business days |
| Initial assessment (severity, scope, validity) | within 7 days |
| Fix or mitigation plan for confirmed issues | within 30 days, faster for critical issues |
| Public disclosure | after a fix is available, coordinated with you |

These are targets, not guarantees; we will keep you updated if a timeline slips.

## Scope

In scope:

| Component | Location | Examples |
| --- | --- | --- |
| Smart contracts | `contracts/` (registry, bot_nft, accrual, marketplace, token) | auth bypass, reentrancy-style flaws, arithmetic errors, broken invariants, unauthorized mint/transfer, escrow theft |
| Frontend | `frontend/` | XSS, wallet-interaction flaws, transaction tampering, leaked secrets |
| Indexer | `indexer/` | injection, denial of service, data integrity, exposed credentials |

Out of scope:

- Vulnerabilities in third-party dependencies, Stellar/Soroban itself, or wallets (report those upstream; tell us if AutoMint is specifically affected).
- Social engineering, phishing, or physical attacks.
- Automated scanner output without a demonstrated impact.
- Issues that only affect outdated, unsupported, or locally modified deployments.
- Findings already listed in [`SECURITY_ISSUES_REPORT.md`](SECURITY_ISSUES_REPORT.md) or [`SECURITY_REVIEW_SUMMARY.md`](SECURITY_REVIEW_SUMMARY.md), which are internal review notes.

## Supported Versions

Security fixes are applied to the default branch (`testnet-implementation`).
AutoMint is currently deployed on Stellar testnet only.

## Safe Harbor

If you act in good faith, avoid privacy violations and service disruption, only
test against your own accounts or a local/testnet deployment, and give us a
reasonable chance to fix the issue before disclosure, we will not pursue legal
action over your research.
