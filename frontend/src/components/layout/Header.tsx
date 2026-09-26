"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Wallet, LogOut, AlertTriangle, Loader2, Download, Copy } from "lucide-react";
import clsx from "clsx";
import { useWallet } from "@/hooks/useWallet";
import { useFocusLock } from "@/hooks/useFocusLock";
import { truncateAddress, fullAddressTitle, fullAddressAriaLabel, useCopyToClipboard } from "@/lib/truncateAddress";

const navLinks = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Marketplace", href: "/marketplace" },
  { label: "Leaderboard", href: "/leaderboard" },
]

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { publicKey, isConnected, networkMismatch, isConnecting, isNotInstalled, connect, disconnect } = useWallet();
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  // Hook must run at the top level — calling it inside the copy button's
  // onClick was a rules-of-hooks violation that crashed on click.
  const { isCopied, handleCopy } = useCopyToClipboard(publicKey ?? "");

  useFocusLock(mobileMenuRef, () => setMobileOpen(false));

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const linkClass = (isActive: boolean, mobile = false) =>
    clsx(
      "rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      mobile ? "px-3 py-2.5 text-sm" : "px-3 py-2 text-sm",
      isActive
        ? "bg-card-2 text-text"
        : "text-muted hover:bg-card-2 hover:text-text",
    );

  // Determine the wallet button label and state (#532)
  const getWalletButtonConfig = () => {
    if (isConnecting) {
      return {
        label: "Connecting...",
        icon: Loader2,
        disabled: true,
        ariaLabel: "Connecting wallet, please wait",
      };
    }
    if (isNotInstalled) {
      return {
        label: "Install Freighter",
        icon: Download,
        disabled: false,
        ariaLabel: "Install Freighter wallet",
      };
    }
    if (networkMismatch) {
      return {
        label: "Wrong Network",
        icon: AlertTriangle,
        disabled: false,
        ariaLabel: "Wallet connected to wrong network, switch to Testnet",
      };
    }
    return {
      label: "Connect Wallet",
      icon: Wallet,
      disabled: false,
      ariaLabel: "Connect wallet",
    };
  };

  const walletConfig = getWalletButtonConfig();
  const WalletIcon = walletConfig.icon;

  return (
    <header className="sticky top-0 z-50 border-b border-liner bg-bg/80 backdrop-blur-xl">
      {networkMismatch && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-2 flex items-center gap-2 text-sm text-yellow-200" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Freighter is connected to the wrong network.{" "}
            <strong>Switch to Testnet</strong> in Freighter settings to continue.
          </span>
        </div>
      )}
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link
          href="/"
          className="flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-lg"
          aria-label="AutoMint Home"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold/10">
            <span className="font-display text-sm font-bold text-gold">A</span>
          </div>
          <span className="font-display text-lg font-bold text-text">AutoMint</span>
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={linkClass(isActive)}
                aria-current={isActive ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {isConnected && publicKey ? (
            <div className="flex items-center gap-2 rounded-xl border border-liner bg-card-2 px-3 py-2">
              <Wallet className="h-4 w-4 text-green" aria-hidden="true" />
              <span
                className="text-sm font-medium text-text"
                title={fullAddressTitle(publicKey)}
                aria-label={fullAddressAriaLabel(publicKey)}
              >
                {truncateAddress(publicKey)}
              </span>
              <button
                onClick={() => {
                  handleCopy();
                }}
                className="ml-2 rounded-lg p-1 text-xs text-gold hover:bg-gold/10 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-label="Copy address"
                title="Copy address"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              {isCopied && <span className="ml-1 text-xs text-green">Copied!</span>}
              <button
                onClick={() => disconnect()}
                className="ml-1 rounded-lg p-1 text-xs text-muted hover:text-pink hover:bg-pink/10 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-label="Disconnect wallet"
                title="Disconnect wallet"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={walletConfig.disabled}
              aria-label={walletConfig.ariaLabel}
              aria-busy={isConnecting}
              className={clsx(
                "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium border transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                isConnecting
                  ? "bg-gold/5 border-gold/20 text-gold/60 cursor-not-allowed"
                  : isNotInstalled
                    ? "bg-blue/10 border-blue/30 text-blue hover:bg-blue/20 hover:border-blue/50"
                    : networkMismatch
                      ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-200 hover:bg-yellow-500/20"
                      : "bg-gold/10 text-gold border-gold/30 hover:bg-gold/20 hover:border-gold/50",
              )}
            >
              <WalletIcon className={clsx("h-4 w-4", isConnecting && "animate-spin")} aria-hidden="true" />
              {walletConfig.label}
            </button>
          )}
        </div>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="flex items-center justify-center rounded-lg p-2 text-muted hover:text-text md:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>

      {mobileOpen && (
        <div
          ref={mobileMenuRef}
          className="border-t border-liner md:hidden"
          role="dialog"
          aria-label="Mobile navigation"
          aria-modal="true"
        >
          <div className="flex flex-col gap-1 px-6 py-4">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={linkClass(isActive, true)}
                  aria-current={isActive ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="mt-2 border-t border-liner pt-2">
              {isConnected && publicKey ? (
                <div className="flex items-center justify-between rounded-xl border border-liner bg-card-2 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-green" aria-hidden="true" />
                    <span className="text-sm font-medium text-text">
                      {truncateAddress(publicKey)}
                    </span>
                  </div>
                  <button
                    onClick={() => { disconnect(); setMobileOpen(false); }}
                    className="rounded-lg p-1 text-muted hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    aria-label="Disconnect wallet"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { connect(); setMobileOpen(false); }}
                  disabled={walletConfig.disabled}
                  aria-label={walletConfig.ariaLabel}
                  aria-busy={isConnecting}
                  className={clsx(
                    "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium border transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    isConnecting
                      ? "bg-gold/5 border-gold/20 text-gold/60 cursor-not-allowed"
                      : isNotInstalled
                        ? "bg-blue/10 border-blue/30 text-blue hover:bg-blue/20 hover:border-blue/50"
                        : networkMismatch
                          ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-200 hover:bg-yellow-500/20"
                          : "bg-gold/10 text-gold border-gold/30 hover:bg-gold/20 hover:border-gold/50",
                  )}
                >
                  <WalletIcon className={clsx("h-4 w-4", isConnecting && "animate-spin")} aria-hidden="true" />
                  {walletConfig.label}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
