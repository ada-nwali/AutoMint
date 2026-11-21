import { Networks } from '@stellar/stellar-sdk';

export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? 'TESTNET') as 'TESTNET' | 'MAINNET';

export const NETWORK_PASSPHRASE =
  NETWORK === 'MAINNET' ? Networks.PUBLIC : Networks.TESTNET;

export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  'https://soroban-testnet.stellar.org';

export const HORIZON_URL =
  NETWORK === 'MAINNET'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';

export const CONTRACT_ADDRESSES = {
  REGISTRY:    process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID    ?? '',
  BOT_NFT:     process.env.NEXT_PUBLIC_BOT_NFT_CONTRACT_ID     ?? '',
  ACCRUAL:     process.env.NEXT_PUBLIC_ACCRUAL_CONTRACT_ID     ?? '',
  MARKETPLACE: process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID ?? '',
  TOKEN:       process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID       ?? '',
  registry:    process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID    ?? '',
  botNft:      process.env.NEXT_PUBLIC_BOT_NFT_CONTRACT_ID     ?? '',
  accrual:     process.env.NEXT_PUBLIC_ACCRUAL_CONTRACT_ID     ?? '',
  marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ID ?? '',
  token:       process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID       ?? '',
} as const;

export const contractAddresses = CONTRACT_ADDRESSES;

export const CONTRACTS = CONTRACT_ADDRESSES;
export type ContractName =
  | 'REGISTRY' | 'BOT_NFT' | 'ACCRUAL' | 'MARKETPLACE' | 'TOKEN'
  | 'registry' | 'botNft' | 'accrual' | 'marketplace' | 'token';
export const STELLAR_NETWORK_PASSPHRASE = NETWORK_PASSPHRASE;
export const ANONYMOUS_READ_SOURCE =
  process.env.NEXT_PUBLIC_SIMULATION_SOURCE ??
  'GDQ6QUVINBCLB3ZCA5BHDBI6E7BNJGCIDWX7WPE2F7UYSGD7P5KBPM2F';

export const TX_TIMEOUT = 30; // seconds

export const POINTS_PER_AMT = 100; // 100 points = 1 AMT token

export const LEADERBOARD_LIMIT = 50;

export const POLL_INTERVAL_MS = 30_000; // 30s for contract reads
export const COUNTER_TICK_MS = 1_000;   // 1s for animated counter

export const BASE_FEE = '10000000'; // 1 XLM max fee

export const FREIGHTER_DOWNLOAD = 'https://www.freighter.app/';
