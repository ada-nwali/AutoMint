'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, RefreshCw, Loader2, AlertCircle, ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useWallet } from '@/hooks/useWallet';
import { useAccrual } from '@/hooks/useAccrual';
import { PointsCounter } from '@/components/dashboard/PointsCounter';
import { ClaimButton } from '@/components/dashboard/ClaimButton';
import { BotCard } from '@/components/dashboard/BotCard';
import { ListBotModal } from '@/components/marketplace/ListBotModal';
import { CardSkeleton, BotCardSkeleton } from '@/components/ui/Skeleton';
import { useMarketplace } from '@/hooks/useMarketplace';
import { TIER_META } from '@/types';
import type { BotNFT } from '@/types';

export default function DashboardPage() {
  const { isConnected, publicKey, connect, status } = useWallet();
  const {
    profile, bots, accrualState, amtBalance, displayedPoints, ratePerHour,
    isLoading, isClaiming, isRegistering, registered, claim, register, refetch, secondsToNextAmt,
  } = useAccrual(publicKey);

  const { listBot, isListing } = useMarketplace(publicKey);
  const [username, setUsername] = useState('');
  const [listingBot, setListingBot] = useState<BotNFT | null>(null);

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6"
          style={{ background: 'var(--card-2)' }}
        >
          <Bot className="w-9 h-9" style={{ color: 'var(--green)' }} />
        </div>
        <h1 className="memefi-h2 mb-3">Your Dashboard</h1>
        <p className="mb-10 text-sm" style={{ color: 'var(--muted)' }}>
          Connect your Freighter wallet to view your bots, track points, and claim $AMT tokens.
        </p>
        <button
          onClick={connect}
          disabled={status === 'connecting'}
          className="btn-primary mx-auto"
        >
          {status === 'connecting' ? 'Connecting…' : 'Connect Wallet'}
        </button>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <CardSkeleton />
        <div className="grid sm:grid-cols-2 gap-4">
          <CardSkeleton /><CardSkeleton />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <BotCardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  // ── Dashboard (registered + unregistered both land here) ──────────────────
  const pendingPoints = accrualState
    ? Math.max(0, Math.floor(((Date.now() / 1000 - Number(accrualState.lastClaimTs ?? accrualState.last_claim_ts)) * ratePerHour) / 3600))
    : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

      {/* ── Registration banner (shown only when not registered) ── */}
      <AnimatePresence>
        {!registered && (
          <motion.div
            key="register-banner"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            className="mb-8 rounded-2xl p-6"
            style={{
              background: 'linear-gradient(135deg, rgba(52,224,138,0.08) 0%, rgba(52,224,138,0.04) 100%)',
              border: '1px solid rgba(52,224,138,0.3)',
            }}
          >
            <div className="flex items-start gap-4">
              <div
                className="shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(52,224,138,0.15)' }}
              >
                <Sparkles className="w-5 h-5" style={{ color: 'var(--green)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm mb-0.5" style={{ fontFamily: "'Sora', sans-serif", color: 'var(--text)' }}>
                  Claim your free Basic Bot
                </p>
                <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
                  Pick a username to register on-chain and instantly start earning $AMT.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.slice(0, 32))}
                    placeholder="Choose a username (max 32 chars)"
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none transition-all"
                    style={{
                      background: 'var(--card-2)',
                      border: '1px solid var(--liner)',
                      color: 'var(--text)',
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--green)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--liner)')}
                    onKeyDown={(e) => e.key === 'Enter' && username.trim() && !isRegistering && register(username.trim())}
                  />
                  <button
                    onClick={() => username.trim() && register(username.trim())}
                    disabled={isRegistering || !username.trim()}
                    className="btn-primary shrink-0"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {isRegistering ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Registering…</>
                    ) : (
                      'Register & Start Mining'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="font-black uppercase tracking-tight"
            style={{ fontFamily: "'Sora', sans-serif", fontSize: '26px', color: 'var(--text)' }}
          >
            {registered
              ? <>GM, <span style={{ color: 'var(--green)' }}>{profile?.username ?? 'Miner'}</span> 👋</>
              : 'Your Dashboard'
            }
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            {registered
              ? 'Your bots are mining 24/7 on Stellar'
              : 'Register above to start earning $AMT'
            }
          </p>
        </div>
        <button
          onClick={refetch}
          aria-label="Refresh"
          className="p-2 rounded-xl transition-colors"
          style={{ border: '1px solid var(--liner)', color: 'var(--muted)', background: 'transparent' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted)')}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ── Main grid ─────────────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          <PointsCounter
            displayedPoints={registered ? displayedPoints : 0}
            ratePerHour={registered ? ratePerHour : 0}
            bots={registered ? bots : []}
            amtBalance={registered ? amtBalance : 0n}
            secondsToNextAmt={registered ? secondsToNextAmt : null}
          />
        </div>
        <ClaimButton
          pendingPoints={registered ? pendingPoints : 0}
          isClaiming={isClaiming}
          onClaim={claim}
          disabled={!isConnected || !registered}
        />
      </div>

      {/* ── Bots section ──────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <h2
            className="font-black uppercase text-base tracking-wide"
            style={{ fontFamily: "'Sora', sans-serif", color: 'var(--text)' }}
          >
            Your Bots{' '}
            <span style={{ color: 'var(--muted)', fontWeight: 400, textTransform: 'none', fontSize: '13px' }}>
              ({registered ? bots.length : 0})
            </span>
          </h2>
          {registered && (
            <Link href="/marketplace">
              <button
                className="text-xs font-semibold px-3 py-1.5 rounded-xl transition-all"
                style={{ border: '1px solid rgba(52,224,138,0.35)', color: 'var(--green)', background: 'rgba(52,224,138,0.08)' }}
              >
                + Buy More
              </button>
            </Link>
          )}
        </div>

        {!registered ? (
          <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--card)' }}>
            <Bot className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--muted)', opacity: 0.3 }} />
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Register above to receive your free Basic Bot and start mining.
            </p>
          </div>
        ) : bots.length === 0 ? (
          <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--card)' }}>
            <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--muted)', opacity: 0.4 }} />
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              No bots found. Visit the{' '}
              <Link href="/marketplace" style={{ color: 'var(--green)' }}>Marketplace</Link>{' '}
              to buy one.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {bots.map((bot) => (
              <BotCard key={String(bot.id)} bot={bot} onList={setListingBot} />
            ))}
          </div>
        )}
      </div>

      {/* ── Upgrade prompt ────────────────────────────────────────────────── */}
      {registered && bots.length > 0 && ratePerHour < 500 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-8 rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4"
          style={{ background: 'var(--card-2)', border: '1px solid rgba(157,123,255,0.25)' }}
        >
          <div>
            <p className="font-semibold text-sm" style={{ color: 'var(--text)', fontFamily: "'Sora', sans-serif" }}>
              {TIER_META.Diamond.emoji} Boost with a Diamond Bot
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              Earn 500 pts/hr — the maximum accrual rate.
            </p>
          </div>
          <Link href="/marketplace">
            <button
              className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all"
              style={{ background: 'rgba(157,123,255,0.15)', border: '1px solid rgba(157,123,255,0.4)', color: 'var(--purple)' }}
            >
              Browse Marketplace <ArrowRight className="w-4 h-4" />
            </button>
          </Link>
        </motion.div>
      )}

      <ListBotModal
        bot={listingBot}
        isOpen={!!listingBot}
        onClose={() => setListingBot(null)}
        onList={listBot}
        isListing={isListing}
      />
    </div>
  );
}
