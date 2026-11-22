/**
 * Block-explorer link for a transaction hash on the configured network.
 * StellarExpert supports Testnet and Mainnet. Other networks have no link.
 */
export function getExplorerUrl(hash: string): string | undefined {
  const network = (process.env.NEXT_PUBLIC_NETWORK || "TESTNET").trim().toUpperCase();
  switch (network) {
    case "TESTNET":
      return `https://stellar.expert/explorer/testnet/tx/${hash}`;
    case "MAINNET":
    case "PUBLIC":
      return `https://stellar.expert/explorer/public/tx/${hash}`;
    default:
      return undefined;
  }
}
