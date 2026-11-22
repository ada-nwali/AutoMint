/**
 * Smoke test for @stellar/stellar-sdk running under jsdom (jest-environment-jsdom).
 *
 * This exists to catch regressions in jest.setup.ts's jsdom polyfills
 * (TextEncoder/TextDecoder, crypto.subtle/getRandomValues) — stellar-sdk's
 * XDR encoding and keypair generation depend on both, and previously threw
 * under plain jsdom with no polyfills. If someone removes a polyfill this
 * test should fail loudly instead of the failure only showing up in an
 * unrelated feature's test suite.
 */
import {
  Keypair,
  TransactionBuilder,
  Account,
  Operation,
  Asset,
  Networks,
  BASE_FEE,
} from "@stellar/stellar-sdk";

describe("@stellar/stellar-sdk under jsdom", () => {
  it("generates a keypair using crypto.getRandomValues/crypto.subtle", () => {
    const keypair = Keypair.random();
    expect(keypair.publicKey()).toMatch(/^G[A-Z0-9]{55}$/);
    expect(keypair.canSign()).toBe(true);
  });

  it("builds, signs, and encodes a real transaction to XDR", () => {
    const source = Keypair.random();
    const destination = Keypair.random();

    // Sequence number "0" — this account doesn't need to exist on a real
    // network for this test; we're only exercising local XDR building,
    // signing, and (de)serialization, not network calls.
    const account = new Account(source.publicKey(), "0");

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: destination.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(30)
      .build();

    tx.sign(source);

    const xdrString = tx.toXDR();
    expect(typeof xdrString).toBe("string");
    expect(xdrString.length).toBeGreaterThan(0);

    // Round-trip: rebuild the transaction from its own XDR and confirm the
    // signature survives — this exercises XDR decoding as well as encoding.
    const rebuilt = TransactionBuilder.fromXDR(xdrString, Networks.TESTNET);
    expect(rebuilt.toXDR()).toBe(xdrString);
    expect(tx.signatures).toHaveLength(1);
  });
});
