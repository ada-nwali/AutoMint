import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import BotListingCard from "../BotListingCard";
import type { MarketplaceListing, BotNFT } from "@/types";

const mockReclaimMutate = jest.fn();
const mockUpdatePriceMutate = jest.fn();

jest.mock("@/hooks/useMarketplace", () => ({
  useTokenDecimals: () => ({ data: 7 }),
  useTokenSymbol: () => ({ data: "XLM" }),
  useReclaimExpired: () => ({
    mutate: mockReclaimMutate,
    isPending: false,
  }),
  useUpdatePrice: () => ({
    mutate: mockUpdatePriceMutate,
    isPending: false,
  }),
  useMarketplaceConfig: () => ({
    data: { admin: "GADMIN", botNft: "GBOT", feeBps: 250, royaltyBps: 0 },
  }),
  useMinListingPrice: () => ({ data: undefined }),
}));

jest.mock("@/hooks/usePauseStatus", () => ({
  usePauseStatus: () => ({ listPaused: false, buyPaused: false }),
}));

jest.mock("@/components/ui/Modal", () => {
  return function MockModal({ children, isOpen, title }: any) {
    if (!isOpen) return null;
    return (
      <div data-testid="edit-modal">
        <h2>{title}</h2>
        {children}
      </div>
    );
  };
});

const SELLER = "GSELLER123456789";
const BUYER = "GBUYER123456789";

const ACTIVE_LISTING: MarketplaceListing = {
  id: 10n,
  seller: SELLER,
  bot_id: 1n,
  bot_tier: "Gold",
  price: 50_000_000n,
  currency: "CCURRENCY",
  listed_at: BigInt(Math.floor(Date.now() / 1000) - 100),
  active: true,
  expires_at: BigInt(Math.floor(Date.now() / 1000) + 86400),
};

const EXPIRED_LISTING: MarketplaceListing = {
  id: 11n,
  seller: SELLER,
  bot_id: 2n,
  bot_tier: "Silver",
  price: 20_000_000n,
  currency: "CCURRENCY",
  listed_at: BigInt(Math.floor(Date.now() / 1000) - 200000),
  active: true,
  expires_at: BigInt(Math.floor(Date.now() / 1000) - 1000),
};

const MOCK_BOT: BotNFT = {
  id: 1n,
  nickname: "GoldMiner",
  owner: SELLER,
  tier: "Gold",
  accrual_rate: 100n,
  minted_at: 1700000000,
  last_claim_timestamp: 1700000000n,
};

describe("BotListingCard actions for seller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Edit price action (#1406)", () => {
    it("renders 'Edit price' button for seller on active non-expired listing", () => {
      render(
        <BotListingCard
          listing={ACTIVE_LISTING}
          bot={MOCK_BOT}
          connectedAddress={SELLER}
          onBuy={jest.fn()}
          onCancel={jest.fn()}
        />,
      );

      const editBtn = screen.getByTestId("edit-price-btn-10");
      expect(editBtn).toBeInTheDocument();
      expect(editBtn).toHaveTextContent(/Edit price/i);
    });

    it("opens edit modal when 'Edit price' button is clicked", () => {
      render(
        <BotListingCard
          listing={ACTIVE_LISTING}
          bot={MOCK_BOT}
          connectedAddress={SELLER}
          onBuy={jest.fn()}
          onCancel={jest.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("edit-price-btn-10"));
      expect(screen.getByTestId("edit-modal")).toBeInTheDocument();
      expect(screen.getByText(/Edit Price for/i)).toBeInTheDocument();
    });

    it("does not show 'Edit price' to buyers", () => {
      render(
        <BotListingCard
          listing={ACTIVE_LISTING}
          bot={MOCK_BOT}
          connectedAddress={BUYER}
          onBuy={jest.fn()}
          onCancel={jest.fn()}
        />,
      );

      expect(screen.queryByTestId("edit-price-btn-10")).not.toBeInTheDocument();
    });
  });

  describe("Reclaim bot action (#1407)", () => {
    it("renders 'Reclaim bot' button for seller on expired listing", () => {
      render(
        <BotListingCard
          listing={EXPIRED_LISTING}
          connectedAddress={SELLER}
          onBuy={jest.fn()}
          onCancel={jest.fn()}
        />,
      );

      const reclaimBtn = screen.getByTestId("reclaim-btn-11");
      expect(reclaimBtn).toBeInTheDocument();
      expect(reclaimBtn).toHaveTextContent(/Reclaim bot/i);
      expect(screen.queryByTestId("cancel-btn-11")).not.toBeInTheDocument();
    });

    it("triggers onReclaim when user confirms reclaim dialog", () => {
      const handleReclaim = jest.fn();
      render(
        <BotListingCard
          listing={EXPIRED_LISTING}
          connectedAddress={SELLER}
          onBuy={jest.fn()}
          onCancel={jest.fn()}
          onReclaim={handleReclaim}
        />,
      );

      fireEvent.click(screen.getByTestId("reclaim-btn-11"));
      // Confirm dialog opens
      expect(screen.getByText(/Reclaim Expired Bot/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /^Reclaim$/i }));

      expect(handleReclaim).toHaveBeenCalledWith(11n);
    });
  });
});
