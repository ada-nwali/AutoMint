"use client";

import { useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { StrKey } from "@stellar/stellar-sdk";
import { AlertTriangle, ArrowLeft, Send } from "lucide-react";
import clsx from "clsx";
import { useTransferBot } from "@/hooks/useMarketplace";
import { useWalletStore, selectPublicKey, selectNetworkMismatch } from "@/store/walletStore";
import { CONTRACT_ADDRESSES } from "@/lib/constants";
import { truncateAddress } from "@/lib/truncateAddress";
import { BOT_TIER_NAMES } from "@/types";
import type { BotNFT } from "@/types";

const Modal = dynamic(() => import("@/components/ui/Modal"), { ssr: false });

interface SendBotModalProps {
  bot: BotNFT;
  isOpen: boolean;
  onClose: () => void;
}

type Validation =
  | { isValid: true; error: null; isContract: boolean }
  | { isValid: false; error: string };

/**
 * Validate a recipient for bot_nft `transfer` (#1415). Accepts a Stellar
 * account (G…) or contract (C…) address with a valid StrKey checksum, and
 * rejects the sender's own address (a no-op on-chain) and AutoMint's own
 * contracts, which have no way to send a bot back.
 */
export function validateRecipient(input: string, sender: string | null): Validation {
  const to = input.trim();
  if (!to) return { isValid: false, error: "Enter the recipient's Stellar address." };

  const isAccount = StrKey.isValidEd25519PublicKey(to);
  const isContract = !isAccount && StrKey.isValidContract(to);
  if (!isAccount && !isContract) {
    return {
      isValid: false,
      error:
        "Not a valid Stellar address. It should start with G (or C for a contract) and be 56 characters.",
    };
  }
  if (sender && to === sender) {
    return { isValid: false, error: "You already own this bot — enter a different address." };
  }
  if (Object.values(CONTRACT_ADDRESSES).includes(to)) {
    return {
      isValid: false,
      error: "That is an AutoMint contract address. Sending a bot there would lock it.",
    };
  }
  return { isValid: true, error: null, isContract };
}

export default function SendBotModal({ bot, isOpen, onClose }: SendBotModalProps) {
  const publicKey = useWalletStore(selectPublicKey);
  const networkMismatch = useWalletStore(selectNetworkMismatch);
  const transfer = useTransferBot();
  const inputId = useId();

  const [recipient, setRecipient] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const botLabel = `${bot.nickname || BOT_TIER_NAMES[bot.tier]} #${bot.id.toString()}`;
  const validation = useMemo(() => validateRecipient(recipient, publicKey), [recipient, publicKey]);
  const to = recipient.trim();

  const handleClose = () => {
    setRecipient("");
    setTouched(false);
    setConfirming(false);
    onClose();
  };

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (validation.isValid) setConfirming(true);
  };

  const handleConfirm = () => {
    if (!validation.isValid) return;
    transfer.mutate({ botId: bot.id, to }, { onSuccess: handleClose });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={confirming ? `Confirm Sending ${botLabel}` : `Send ${botLabel}`}
      description={
        confirming
          ? "Transfers are final. Check the address — a bot sent to the wrong address cannot be recovered."
          : "Send this bot directly to another Stellar address. No listing or marketplace fee."
      }
    >
      {confirming ? (
        <div className="flex flex-col gap-4" data-testid="send-bot-confirm">
          <dl className="rounded-xl border border-liner bg-card-2 p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Bot</dt>
              <dd className="font-medium text-text">{botLabel}</dd>
            </div>
            <div className="mt-2 flex flex-col gap-1">
              <dt className="text-muted">Recipient</dt>
              <dd className="break-all font-mono text-xs text-text">{to}</dd>
            </div>
          </dl>

          {validation.isValid && validation.isContract && (
            <p className="flex items-start gap-2 text-xs text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              This is a contract address. Only send if you know the contract can hold and return
              bots.
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={transfer.isPending}
              className={clsx(
                "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium",
                "text-muted hover:bg-card-2 hover:text-text transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={transfer.isPending || networkMismatch}
              aria-busy={transfer.isPending}
              className="btn-primary flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {transfer.isPending ? "Sending…" : "Send Bot"}
            </button>
          </div>
          {networkMismatch && (
            <p role="status" className="text-center text-xs text-muted">
              Freighter is on the wrong network — switch networks to send.
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={handleReview} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium text-text">
              Recipient address
            </label>
            <input
              id={inputId}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="G…"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && !validation.isValid}
              aria-describedby={touched && !validation.isValid ? `${inputId}-error` : undefined}
              className={clsx(
                "w-full rounded-xl border bg-card-2 px-4 py-3 font-mono text-sm text-text placeholder:text-muted/50",
                "focus:outline-none focus:ring-2",
                touched && !validation.isValid
                  ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/30"
                  : "border-liner focus:border-gold/50 focus:ring-gold/30",
              )}
            />
            {touched && !validation.isValid && (
              <p id={`${inputId}-error`} role="alert" className="text-xs font-medium text-red-400">
                {validation.error}
              </p>
            )}
            {validation.isValid && (
              <p className="text-xs text-muted">Sending to {truncateAddress(to)}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={!validation.isValid}
            className="btn-primary w-full py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            Review Transfer
          </button>
        </form>
      )}
    </Modal>
  );
}
