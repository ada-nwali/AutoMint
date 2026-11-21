'use client';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { User, Copy, ExternalLink, Bot, Zap, Coins, Calendar } from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';
import { useAccrual } from '@/hooks/useAccrual';
import { BotCard } from '@/components/dashboard/BotCard';
import { CardSkeleton, BotCardSkeleton } from '@/components/ui/Skeleton';
import { formatPoints, TIER_META, tierFromIndex } from '@/types';
import { truncateAddress } from '@/lib/stellar';
import { toast } from 'sonner';
import { NETWORK } from '@/lib/constants';
import { getUserPurchasesPage } from '@/lib/contracts';

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
  toast.success('Copied to clipboard');
}

export default function ProfilePage() {
  const { isConnected, publicKey, connect, status } = useWallet();
  const { profile, bots, amtBalance, ratePerHour, isLoading } = useAccrual(publicKey);
  const [activeTab, setActiveTab] = useState<'bots' | 'purchases'>('bots');
  const purchasesQuery = useQuery({
    queryKey: ['purchases', publicKey],
    queryFn: () => publicKey ? getUserPurchasesPage(publicKey) : Promise.resolve([]),
    enabled: !!publicKey,
  });

  const horizonUrl = NETWORK === 'MAINNET'
    ? `https://stellar.expert/explorer/public/account/${publicKey}`
    : `https://stellar.expert/explorer/testnet/account/${publicKey}`;

  if (!isConnected) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center">
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6"
          style={{ background: 'var(--card-2)' }}
        >
          <User className="w-10 h-10" style={{ color: 'var(--muted)' }} />
        </div>
        <h1 className="memefi-h2 mb-3" style={{ fontSize: '28px' }}>Your Profile</h1>
        <p className="mb-10" style={{ color: 'var(--muted)' }}>Connect your wallet to view your profile.</p>
        <button onClick={connect} disabled={status === 'connecting'} className="btn-primary mx-auto">
          {status === 'connecting' ? 'Connecting…' : 'Connect Wallet'}
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <CardSkeleton />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <BotCardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  const regDate = profile?.registeredAt
    ? new Date(Number(profile.registeredAt) * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const tierCounts = bots.reduce<Record<string, number>>((acc, bot) => {
    acc[bot.tier] = (acc[bot.tier] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="memefi-h2 mb-8" style={{ fontSize: '32px' }}>Profile</h1>

      {/* Identity card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mf-card mb-6"
        style={{ padding: '28px' }}
      >
        <div className="flex items-center gap-5">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black shrink-0"
            style={{
              background: 'var(--card-2)',
              border: '1px solid var(--liner)',
              fontFamily: "'Sora', sans-serif",
              color: 'var(--gold)',
            }}
          >
            {profile?.username?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <h2
              className="font-black uppercase tracking-tight"
              style={{ fontFamily: "'Sora', sans-serif", fontSize: '20px', color: 'var(--text)' }}
            >
              {profile?.username ?? 'Unknown'}
            </h2>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xs font-mono truncate" style={{ color: 'var(--muted)' }}>
                {publicKey ? truncateAddress(publicKey, 10) : '—'}
              </span>
              <button
                onClick={() => publicKey && copyToClipboard(publicKey)}
                aria-label="Copy address"
                style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--muted)')}
              >
                <Copy className="w-3 h-3" />
              </button>
              {publicKey && (
                <a href={horizonUrl} target="_blank" rel="noreferrer" aria-label="View on explorer" style={{ color: 'var(--muted)' }}>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            {regDate && (
              <div className="flex items-center gap-1 mt-1 text-xs" style={{ color: 'var(--muted)', opacity: 0.6 }}>
                <Calendar className="w-3 h-3" />
                Joined {regDate}
              </div>
            )}
          </div>
          <div className="hidden sm:block text-right shrink-0">
            <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Network</div>
            <div className="text-sm font-bold mt-0.5" style={{ color: 'var(--blue)', fontFamily: "'Sora', sans-serif" }}>{NETWORK}</div>
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { icon: Zap,   label: 'TOTAL POINTS', value: formatPoints(profile?.totalPoints ?? 0n), color: 'var(--gold)' },
          { icon: Coins, label: '$AMT EARNED',  value: Number(amtBalance).toLocaleString(),       color: 'var(--green)' },
          { icon: Bot,   label: 'BOT FLEET',    value: String(bots.length),                       color: 'var(--purple)' },
          { icon: Zap,   label: 'RATE/HR',      value: formatPoints(ratePerHour),                 color: 'var(--blue)' },
        ].map(({ icon: Icon, label, value, color }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="mf-card-2 text-center"
            style={{ padding: '20px 12px', borderRadius: '20px' }}
          >
            <Icon className="w-5 h-5 mx-auto mb-2" style={{ color }} />
            <div className="text-xs uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--muted)' }}>
              {label}
            </div>
            <div
              className="font-black"
              style={{ fontFamily: "'Sora', sans-serif", fontSize: '22px', color, lineHeight: 1 }}
            >
              {value}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Tier breakdown */}
      {bots.length > 0 && (
        <div className="mf-card mb-6" style={{ padding: '24px' }}>
          <h3 className="memefi-h3 text-sm mb-4" style={{ fontSize: '14px' }}>Bot Collection</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(tierCounts).map(([tier, count]) => {
              const meta = TIER_META[tier as keyof typeof TIER_META];
              return (
                <div
                  key={tier}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
                  style={{ border: `1px solid ${meta.color}30`, background: `${meta.color}10` }}
                >
                  <span>{meta.emoji}</span>
                  <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                  <span style={{ color: 'var(--text)', fontWeight: 800, fontFamily: "'Sora', sans-serif" }}>×{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div
        className="flex items-center gap-1 mb-5 p-1 w-fit rounded-xl"
        style={{ background: 'var(--card)' }}
      >
        {([
          ['bots', `Bots (${bots.length})`],
          ['purchases', `Purchases (${purchasesQuery.data?.length ?? 0})`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={activeTab === id
              ? { background: 'var(--card-2)', color: 'var(--text)' }
              : { background: 'transparent', color: 'var(--muted)' }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'bots' ? (
        bots.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {bots.map((bot) => <BotCard key={String(bot.id)} bot={bot} />)}
          </div>
        ) : (
          <p className="text-sm text-center py-10" style={{ color: 'var(--muted)' }}>No bots yet.</p>
        )
      ) : (
        purchasesQuery.isLoading ? (
          <div className="grid gap-3"><CardSkeleton /><CardSkeleton /></div>
        ) : purchasesQuery.data?.length ? (
          <div className="grid gap-3">
            {purchasesQuery.data.map((purchase) => {
              const tierName = typeof purchase.bot_tier === 'string'
                ? purchase.bot_tier
                : TIER_META[tierFromIndex(Number(purchase.bot_tier)) as keyof typeof TIER_META].tier;
              const date = new Date(Number(purchase.purchased_at) * 1000).toLocaleString();
              return (
                <div key={`${purchase.listing_id}-${purchase.bot_id}`} className="mf-card-2 flex items-center justify-between" style={{ padding: '16px 20px' }}>
                  <div>
                    <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>{tierName} Bot #{String(purchase.bot_id)}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Seller {truncateAddress(purchase.seller, 8)} · {date}</div>
                  </div>
                  <div className="text-sm font-bold" style={{ color: 'var(--gold)' }}>{(Number(purchase.price) / 10_000_000).toLocaleString()} AMT</div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-center py-10" style={{ color: 'var(--muted)' }}>No on-chain purchases yet.</p>
        )
      )}
    </div>
  );
}
