/**
 * Configuration resolution for the indexer.
 *
 * Contract IDs are read from (in order of precedence):
 *   1. the `deployments/<network>.json` manifest produced by
 *      `scripts/deploy.sh` (issues #557/#559) — the single source of truth for
 *      "which contracts did we actually deploy",
 *   2. explicit `AM_*_CONTRACT_ID` env vars (useful when the manifest is not
 *      present, e.g. a fresh mainnet deployment not yet run through deploy.sh),
 *   3. the frontend's `frontend/.env.local` (`NEXT_PUBLIC_*_CONTRACT_ID`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_NAMES, type ContractConfig, type ContractName } from "./types.js";

export const DEFAULT_NETWORK = process.env.AM_NETWORK ?? "testnet";

export const CONTRACT_ENV_VARS: Record<ContractName, string[]> = {
  registry: ["AM_REGISTRY_CONTRACT_ID", "NEXT_PUBLIC_REGISTRY_CONTRACT_ID"],
  bot_nft: ["AM_BOT_NFT_CONTRACT_ID", "NEXT_PUBLIC_BOT_NFT_CONTRACT_ID"],
  accrual: ["AM_ACCRUAL_CONTRACT_ID", "NEXT_PUBLIC_ACCRUAL_CONTRACT_ID"],
  marketplace: ["AM_MARKETPLACE_CONTRACT_ID", "NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID"],
  token: ["AM_TOKEN_CONTRACT_ID", "NEXT_PUBLIC_TOKEN_CONTRACT_ID"],
};

function repoRoot(): string {
  // indexer/src/config.ts → indexer → repo root (works for dist/config.js too).
  // fileURLToPath decodes %20 and yields a native C:\ path on Windows (#1234).
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Normalize a raw contract address (trim, uppercase C/G prefix). */
function normalizeContractId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const id = raw.trim();
  if (!id) return null;
  return id.toUpperCase();
}

/** Read `frontend/.env.local` and return KEY=VALUE pairs. */
export function readDotEnvLocal(file: string): Record<string, string> {
  try {
    const txt = fs.readFileSync(file, "utf8");
    const out: Record<string, string> = {};
    for (const line of txt.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();

      if (val.startsWith('"')) {
        const endQuote = val.indexOf('"', 1);
        if (endQuote !== -1) {
          val = val.slice(1, endQuote);
        } else {
          val = val.slice(1);
        }
      } else if (val.startsWith("'")) {
        const endQuote = val.indexOf("'", 1);
        if (endQuote !== -1) {
          val = val.slice(1, endQuote);
        } else {
          val = val.slice(1);
        }
      } else {
        const commentIdx = val.indexOf("#");
        if (commentIdx !== -1) {
          val = val.slice(0, commentIdx).trim();
        }
      }
      out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

export interface LoadedConfig {
  config: ContractConfig;
  /** Where each contract id came from (for logging/audit). */
  sources: Record<ContractName, string>;
  missing: ContractName[];
}

/**
 * Resolve the five contract IDs.
 * @param manifestPath Explicit path to the deployment manifest. Defaults to
 *   `<repo>/deployments/<network>.json`.
 */
export function loadContractConfig(network = DEFAULT_NETWORK): LoadedConfig {
  const root = repoRoot();
  const manifestPath =
    process.env.AM_MANIFEST ?? path.join(root, "deployments", `${network}.json`);

  const contracts = {} as Record<ContractName, string>;
  const sources = {} as Record<ContractName, string>;
  const missing: ContractName[] = [];

  // 1. Deployment manifest (from scripts/deploy.sh).
  let manifest: {
    contracts?: Record<string, { contract_id?: string }>;
    git_sha?: string;
  } = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (err) {
      throw new Error(
        `Failed to parse deployment manifest at ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. env vars + frontend/.env.local.
  const dotenv = readDotEnvLocal(path.join(root, "frontend", ".env.local"));

  for (const name of CONTRACT_NAMES) {
    const fromManifest = manifest.contracts?.[name]?.contract_id;
    if (fromManifest) {
      contracts[name] = normalizeContractId(fromManifest)!;
      sources[name] = `manifest:${manifestPath}`;
      continue;
    }
    let found: string | null = null;
    let src = "";
    for (const key of CONTRACT_ENV_VARS[name]) {
      const value = process.env[key] ?? dotenv[key];
      if (value) {
        found = value;
        src = `env:${key}`;
        break;
      }
    }
    if (found) {
      contracts[name] = normalizeContractId(found)!;
      sources[name] = src;
      continue;
    }
    missing.push(name);
  }

  const config: ContractConfig = {
    network,
    contracts,
    gitSha:
      typeof manifest.git_sha === "string" ? manifest.git_sha : undefined,
  };
  return { config, sources, missing };
}

/** Validate that a contract id looks like a Soroban contract address. */
export function isContractAddress(id: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(id);
}

export function assertCompleteConfig(
  loaded: LoadedConfig,
): asserts loaded is LoadedConfig & { config: ContractConfig } {
  if (loaded.missing.length > 0) {
    throw new Error(
      `Missing contract IDs for: ${loaded.missing.join(", ")}. ` +
        `Run ./scripts/deploy.sh ${loaded.config.network} first, or set the ` +
        `AM_*_CONTRACT_ID env vars.`,
    );
  }

  // Every resolved ID feeds the RPC `getEvents` filters, so a malformed or
  // placeholder value must stop startup here rather than fail on every poll (#659, #1230).
  const invalid = CONTRACT_NAMES.filter(
    (name) => !isContractAddress(loaded.config.contracts[name]),
  );
  if (invalid.length > 0) {
    const details = invalid
      .map(
        (name) =>
          `${name} ("${loaded.config.contracts[name]}", from ${loaded.sources[name]})`,
      )
      .join(", ");
    throw new Error(
      `Invalid contract IDs for: ${details}. Each ID must be a Soroban ` +
        `contract address (C followed by 55 base32 characters).`,
    );
  }
}
