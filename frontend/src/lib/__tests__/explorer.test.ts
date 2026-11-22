import { getExplorerUrl } from "../explorer";

const originalNetwork = process.env.NEXT_PUBLIC_NETWORK;
const hash = "ab".repeat(32);

afterEach(() => {
  if (originalNetwork === undefined) delete process.env.NEXT_PUBLIC_NETWORK;
  else process.env.NEXT_PUBLIC_NETWORK = originalNetwork;
});

it.each([
  ["TESTNET", "testnet"],
  ["MAINNET", "public"],
  ["PUBLIC", "public"],
  [" testnet ", "testnet"],
])("links %s transactions to the correct explorer", (network, path) => {
  process.env.NEXT_PUBLIC_NETWORK = network;
  expect(getExplorerUrl(hash)).toBe(`https://stellar.expert/explorer/${path}/tx/${hash}`);
});

it("defaults to Testnet when no network is configured", () => {
  delete process.env.NEXT_PUBLIC_NETWORK;
  expect(getExplorerUrl(hash)).toBe(`https://stellar.expert/explorer/testnet/tx/${hash}`);
});

it.each(["FUTURENET", "LOCAL", "custom"])("does not link %s transactions to Mainnet", (network) => {
  process.env.NEXT_PUBLIC_NETWORK = network;
  expect(getExplorerUrl(hash)).toBeUndefined();
});
