import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import "@testing-library/jest-dom";
import type { BotNFT } from "@/types";

const mockOwner = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

const mockTransferMutate = jest.fn();
jest.mock("@/hooks/useMarketplace", () => ({
  useTransferBot: () => ({ mutate: mockTransferMutate, isPending: false }),
}));

jest.mock("@/store/walletStore", () => ({
  useWalletStore: (selector: (s: { publicKey: string; networkMismatch: boolean }) => unknown) =>
    selector({ publicKey: mockOwner, networkMismatch: false }),
  selectPublicKey: (s: { publicKey: string }) => s.publicKey,
  selectNetworkMismatch: (s: { networkMismatch: boolean }) => s.networkMismatch,
}));

jest.mock("@/components/ui/Modal", () => {
  return function MockModal({
    children,
    isOpen,
    title,
  }: React.PropsWithChildren<{ isOpen: boolean; title?: string }>) {
    if (!isOpen) return null;
    return (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
      </div>
    );
  };
});

import SendBotModal, { validateRecipient } from "../SendBotModal";
import { CONTRACT_ADDRESSES } from "@/lib/constants";

const BOT: BotNFT = {
  id: 9n,
  owner: mockOwner,
  tier: "Silver",
  accrual_rate: 25n,
  minted_at: 1700000000,
  last_claim_timestamp: 1700000000n,
};

describe("validateRecipient (#1415)", () => {
  it("accepts a valid account address", () => {
    expect(validateRecipient(RECIPIENT, mockOwner)).toEqual({
      isValid: true,
      error: null,
      isContract: false,
    });
  });

  it("accepts a contract address but flags it", () => {
    const contract = StrKey.encodeContract(Buffer.alloc(32, 7));
    expect(validateRecipient(contract, mockOwner)).toMatchObject({
      isValid: true,
      isContract: true,
    });
  });

  it("trims surrounding whitespace", () => {
    expect(validateRecipient(`  ${RECIPIENT} `, mockOwner).isValid).toBe(true);
  });

  it.each([
    ["", /enter the recipient/i],
    ["not-an-address", /not a valid stellar address/i],
    [
      RECIPIENT.slice(0, -1) + (RECIPIENT.endsWith("A") ? "B" : "A"),
      /not a valid stellar address/i,
    ],
  ])("rejects %p", (input, message) => {
    const result = validateRecipient(input, mockOwner);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(message);
  });

  it("rejects the sender's own address", () => {
    expect(validateRecipient(mockOwner, mockOwner).error).toMatch(/already own this bot/i);
  });

  it("rejects AutoMint's own contract addresses", () => {
    const marketplace = StrKey.encodeContract(Buffer.alloc(32, 4));
    const original = CONTRACT_ADDRESSES.marketplace;
    (CONTRACT_ADDRESSES as Record<string, string>).marketplace = marketplace;
    try {
      expect(validateRecipient(marketplace, mockOwner).error).toMatch(/AutoMint contract/i);
    } finally {
      (CONTRACT_ADDRESSES as Record<string, string>).marketplace = original;
    }
  });
});

describe("SendBotModal (#1415)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("blocks review until the address is valid", async () => {
    render(<SendBotModal bot={BOT} isOpen onClose={jest.fn()} />);
    const input = await screen.findByLabelText(/Recipient address/i);
    const review = screen.getByRole("button", { name: /Review Transfer/i });

    expect(review).toBeDisabled();
    await userEvent.type(input, "GBAD");
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toHaveTextContent(/not a valid stellar address/i);
    expect(review).toBeDisabled();
  });

  it("asks for confirmation before sending, then calls transfer", async () => {
    render(<SendBotModal bot={BOT} isOpen onClose={jest.fn()} />);
    await userEvent.type(await screen.findByLabelText(/Recipient address/i), RECIPIENT);
    await userEvent.click(screen.getByRole("button", { name: /Review Transfer/i }));

    // Confirmation step shows the full recipient and nothing is sent yet.
    expect(screen.getByText(/Confirm Sending Silver #9/i)).toBeInTheDocument();
    expect(screen.getByText(RECIPIENT)).toBeInTheDocument();
    expect(mockTransferMutate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Send Bot/i }));
    expect(mockTransferMutate).toHaveBeenCalledWith(
      { botId: 9n, to: RECIPIENT },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("returns to the form from the confirmation step without sending", async () => {
    render(<SendBotModal bot={BOT} isOpen onClose={jest.fn()} />);
    await userEvent.type(await screen.findByLabelText(/Recipient address/i), RECIPIENT);
    await userEvent.click(screen.getByRole("button", { name: /Review Transfer/i }));
    await userEvent.click(screen.getByRole("button", { name: /Back/i }));

    expect(await screen.findByLabelText(/Recipient address/i)).toHaveValue(RECIPIENT);
    expect(mockTransferMutate).not.toHaveBeenCalled();
  });
});
