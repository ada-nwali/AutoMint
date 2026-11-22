/**
 * applyFeeMultiplier against the real stellar-sdk (#1286).
 *
 * A built `Transaction` is immutable, so the old `tx.fee = …` assignment threw
 * for any NEXT_PUBLIC_FEE_MULTIPLIER other than 1 and failed every contract
 * call after simulation. The SDK is deliberately not mocked here: only a real
 * `Transaction` reproduces that immutability.
 */
import {
  Account,
  Contract,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { applyFeeMultiplier } from "../stellar";

/** An assembled-looking Soroban invocation: one op, resource fee, footprint. */
function buildSorobanTx() {
  const contract = new Contract(StrKey.encodeContract(Buffer.alloc(32, 1)));
  const sorobanData = new SorobanDataBuilder()
    .setResourceFee(58_181)
    .setReadOnly([contract.getFootprint()])
    .build();

  return new TransactionBuilder(new Account(Keypair.random().publicKey(), "100"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
    sorobanData,
  })
    .addOperation(contract.call("claim"))
    .setTimeout(30)
    .build();
}

const sorobanDataOf = (tx: ReturnType<typeof buildSorobanTx>) =>
  tx.toEnvelope().v1().tx().ext().sorobanData().toXDR("base64");

describe("applyFeeMultiplier", () => {
  it("scales the fee by 1.5, rounding up, without touching anything else", () => {
    const tx = buildSorobanTx();

    const scaled = applyFeeMultiplier(tx, 1.5);

    // 58281 * 1.5 = 87421.5 -> 87422
    expect(scaled.fee).toBe("87422");
    expect(scaled.sequence).toBe(tx.sequence);
    expect(scaled.source).toBe(tx.source);
    expect(scaled.timeBounds).toEqual(tx.timeBounds);
    expect(scaled.networkPassphrase).toBe(tx.networkPassphrase);
    expect(scaled.toEnvelope().v1().tx().operations()[0].toXDR("base64")).toBe(
      tx.toEnvelope().v1().tx().operations()[0].toXDR("base64"),
    );
    // The resource fee and footprint survive the rebuild.
    expect(sorobanDataOf(scaled)).toBe(sorobanDataOf(tx));
    // The input transaction is left as it was.
    expect(tx.fee).toBe("58281");
  });

  it("returns the transaction unchanged for a multiplier of 1", () => {
    const tx = buildSorobanTx();

    expect(applyFeeMultiplier(tx, 1)).toBe(tx);
  });
});
