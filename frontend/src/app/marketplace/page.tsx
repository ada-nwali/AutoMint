'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, RefreshCw, Filter, Bot, Loader2 } from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';
import { useMarketplace } from '@/hooks/useMarketplace';
import { useAccrual } from '@/hooks/useAccrual';
import { BotListingCard } from '@/components/marketplace/BotListingCard';
import { ListBotModal } from '@/components/marketplace/ListBotModal';
import { BotCard } from '@/components/dashboard/BotCard';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { TIER_META } from '@/types';
import type { BotNFT } from '@/types';

type Tab = 'browse' | 'my-bots' | 'my-listings';

export default function MarketplacePage() {
  const { isConnected, publicKey } = useWallet();
  const [activeTab, setActiveTab] = useState<Tab>('browse');
  const [listingBot, setListingBot] = useState<BotNFT | null>(null);
  const [tierFilter, setTierFilter] = useState<number | null>(null);

  const { listings, myListings, loadingListings, isBuying, isCancelling, isMintingTier, buyBot, cancelListing, listBot, mintTierBot, isListing, refetch } =
    useMarketplace(publicKey, tierFilter);
  const { bots } = useAccrual(publicKey);

  const TABS: { id: Tab; label: string }[] = [
    { id: 'browse', label: `Browse (${listings.length})` },
    ...(isConnected
      ? [
          { id: 'my-bots' as Tab, label: `My Bots (${bots.length})` },
          { id: 'my-listings' as Tab, label: `My Listings (${myListings.filter((l) => l.active).length})` },
        ]
      : []),
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="memefi-h2" style={{ fontSize: '32px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ShoppingBag className="w-7 h-7" style={{ color: 'var(--gold)' }} />
            Marketplace
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Buy and sell Bot NFTs peer-to-peer on Stellar
          </p>
        </div>
        <button
          onClick={() => refetch()}
          aria-label="Refresh"
          className="p-2 rounded-xl transition-colors"
          style={{ border: '1px solid var(--liner)', color: 'var(--muted)', background: 'transparent' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted)')}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div
        className="flex items-center gap-1 mb-7 p-1 w-fit rounded-2xl"
        style={{ background: 'var(--card)' }}
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={
              activeTab === id
                ? { background: 'var(--card-2)', color: 'var(--text)' }
                : { color: 'var(--muted)', background: 'transparent' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* Browse tab */}
      {activeTab === 'browse' && (
        <div>
          {/* Tier filter */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <Filter className="w-4 h-4" style={{ color: 'var(--muted)' }} />
            <button
              onClick={() => setTierFilter(null)}
              className="badge transition-all"
              style={
                tierFilter === null
                  ? { background: 'rgba(52,224,138,0.14)', color: 'var(--green)' }
                  : { background: 'var(--card)', color: 'var(--muted)' }
              }
            >
              All
            </button>
            {Object.values(TIER_META).map((meta) => (
              <button
                key={meta.index}
                onClick={() => setTierFilter(meta.index === tierFilter ? null : meta.index)}
                className="badge transition-all"
                style={
                  tierFilter === meta.index
                    ? { background: `${meta.color}20`, color: meta.color }
                    : { background: 'var(--card)', color: 'var(--muted)' }
                }
              >
                {meta.emoji} {meta.tier}
              </button>
            ))}
          </div>

          {loadingListings ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : listings.length === 0 ? (
            <div className="rounded-2xl p-16 text-center" style={{ background: 'var(--card)' }}>
              <Bot className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--muted)', opacity: 0.4 }} />
              <p style={{ color: 'var(--muted)' }}>No listings yet.</p>
              {isConnected && <p className="text-sm mt-1" style={{ color: 'var(--muted)', opacity: 0.6 }}>List one of your bots to get started!</p>}
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {listings.map((listing) => (
                  <BotListingCard
                    key={String(listing.id)}
                    listing={listing}
                    currentUserAddress={publicKey}
                    onBuy={buyBot}
                    onCancel={cancelListing}
                    isBuying={isBuying}
                    isCancelling={isCancelling}
                  />
                ))}
              </div>
            </AnimatePresence>
          )}
        </div>
      )}

      {/* My bots tab */}
      {activeTab === 'my-bots' && (
        <div>
          {bots.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--card)' }}>
              <Bot className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--muted)', opacity: 0.4 }} />
              <p style={{ color: 'var(--muted)' }}>You don&apos;t own any bots yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {bots.map((bot) => <BotCard key={String(bot.id)} bot={bot} onList={setListingBot} />)}
            </div>
          )}
        </div>
      )}

      {/* My listings tab */}
      {activeTab === 'my-listings' && (
        <div>
          {myListings.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--card)' }}>
              <ShoppingBag className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--muted)', opacity: 0.4 }} />
              <p style={{ color: 'var(--muted)' }}>No active listings.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {myListings.map((listing) => (
                <BotListingCard
                  key={String(listing.id)}
                  listing={listing}
                  currentUserAddress={publicKey}
                  onBuy={buyBot}
                  onCancel={cancelListing}
                  isBuying={isBuying}
                  isCancelling={isCancelling}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Buy new bots */}
      <div className="mt-14">
        <h2
          className="font-black uppercase tracking-wide text-base mb-5"
          style={{ fontFamily: "'Sora', sans-serif", color: 'var(--text)' }}
        >
          Buy New Bots{' '}
          <span style={{ color: 'var(--muted)', fontWeight: 400, textTransform: 'none', fontSize: '13px' }}>
            direct from contract
          </span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Object.values(TIER_META)
            .filter((m) => m.tier !== 'Basic')
            .map((meta) => (
              <motion.div
                key={meta.tier}
                whileHover={{ y: -5 }}
                className="mf-card-2 text-center"
                style={{ padding: '24px 16px', borderRadius: '20px', border: `1px solid ${meta.color}22` }}
              >
                <div className="text-4xl mb-3">{meta.emoji}</div>
                <div
                  className="text-xs font-black uppercase tracking-widest mb-2"
                  style={{ fontFamily: "'Sora', sans-serif", color: meta.color }}
                >
                  {meta.tier}
                </div>
                <div
                  className="font-black mb-0.5"
                  style={{ fontFamily: "'Sora', sans-serif", fontSize: '24px', color: 'var(--gold)', lineHeight: 1 }}
                >
                  {meta.ratePerHour}
                </div>
                <div className="text-xs mb-4" style={{ color: 'var(--muted)' }}>pts/hour</div>
                <div className="text-sm font-bold mb-4" style={{ color: 'var(--gold)' }}>
                  {meta.priceXlm.toLocaleString()} XLM
                </div>
                <button
                  disabled={!isConnected || isMintingTier}
                  onClick={() => isConnected && mintTierBot(meta.index)}
                  className="w-full py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                  style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}35`, cursor: isConnected ? 'pointer' : 'not-allowed', opacity: !isConnected ? 0.5 : 1 }}
                >
                  {isMintingTier ? <><Loader2 className="w-3 h-3 animate-spin" /> Minting…</> : isConnected ? 'Buy Now' : 'Connect Wallet'}
                </button>
              </motion.div>
            ))}
        </div>
      </div>

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
