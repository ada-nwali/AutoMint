"use client";

import { motion } from "framer-motion";
import { Loader2, Coins } from "lucide-react";
import clsx from "clsx";
import { useWalletStore, selectNetworkMismatch } from "@/store/walletStore";

interface ClaimButtonProps {
  pendingPoints: number | bigint;
  onClaim: () => void;
  isClaiming: boolean;
}

export default function ClaimButton({ pendingPoints, onClaim, isClaiming }: ClaimButtonProps) {
  const points = typeof pendingPoints === "bigint" ? Number(pendingPoints) : pendingPoints;
  // Claiming is a mutation: it stays disabled while Freighter is on the
  // wrong network (#455). The runtime guard in executeTransaction is the
  // backstop; this is the user-visible half.
  const networkMismatch = useWalletStore(selectNetworkMismatch);
  const disabled = isClaiming || points <= 0 || networkMismatch;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl border border-liner bg-card p-5 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted" id="pending-points-label">
          Pending Points
        </span>
        <span
          className="font-display text-2xl font-bold text-gold"
          aria-live="polite"
          aria-atomic="true"
          aria-labelledby="pending-points-label"
        >
          {points.toLocaleString()}
        </span>
      </div>

      <button
        type="button"
        onClick={onClaim}
        disabled={disabled}
        aria-busy={isClaiming}
        title={
          networkMismatch && !isClaiming
            ? "Freighter is on the wrong network — switch to Testnet to claim"
            : undefined
        }
        className={clsx(
          "flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          disabled
            ? "border-liner bg-card-2 text-muted cursor-not-allowed opacity-50"
            : "border-gold/30 bg-gold/10 text-gold hover:bg-gold/20 hover:border-gold/50"
        )}
      >
        {networkMismatch && !isClaiming ? (
          <>
            <Coins className="h-4 w-4" aria-hidden="true" />
            Switch Network to Claim
          </>
        ) : isClaiming ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Claiming...
          </>
        ) : (
          <>
            <Coins className="h-4 w-4" aria-hidden="true" />
            Claim Rewards
          </>
        )}
      </button>
    </motion.div>
  );
}
