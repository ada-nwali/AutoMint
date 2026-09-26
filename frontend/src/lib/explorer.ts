/**
 * Block-explorer link for a transaction hash on the configured network.
 * Testnet: https://stellar.expert/explorer/testnet/tx/{hash}
 */
export function getExplorerUrl(hash: string): string {
  const network = process.env.NEXT_PUBLIC_NETWORK || "TESTNET";
  const basePath =
    network === "TESTNET" ? "stellar.expert/explorer/testnet" : "stellar.expert/explorer/public";
  return `https://${basePath}/tx/${hash}`;
}
