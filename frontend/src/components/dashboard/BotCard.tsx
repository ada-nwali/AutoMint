'use client';
import { motion } from 'framer-motion';
import { Zap, Clock, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { executeTransaction } from '@/lib/transaction';
import { addressToScVal, u64ToScVal } from '@/lib/stellar';
import { nativeToScVal } from '@stellar/stellar-sdk';
import { CONTRACT_ADDRESSES } from '@/lib/constants';
import { useWalletStore, selectPublicKey } from '@/store/walletStore';
import { TIER_META } from '@/types';
import type { BotNFT } from '@/types';

interface BotCardProps {
  bot: BotNFT;
  onList?: (bot: BotNFT) => void;
  compact?: boolean;
}

export function BotCard({ bot, onList, compact = false }: BotCardProps) {
  const meta = TIER_META[bot.tier];
  const mintDate = new Date(Number(bot.mintedAt ?? bot.minted_at ?? 0n) * 1000).toLocaleDateString();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(bot.nickname ?? bot.name ?? '');
  const [saving, setSaving] = useState(false);
  const publicKey = useWalletStore(selectPublicKey);
  const queryClient = useQueryClient();

  const saveName = async () => {
    if (!publicKey) return;
    const bytes = new TextEncoder().encode(name);
    if (bytes.length > 24) {
      toast.error('Nickname must be 24 bytes or fewer');
      return;
    }
    setSaving(true);
    try {
      await executeTransaction({
        contractId: CONTRACT_ADDRESSES.botNft,
        method: 'rename_bot',
        args: [
          addressToScVal(publicKey),
          u64ToScVal(bot.id),
          nativeToScVal(name, { type: 'string' }),
        ],
        sourceAddress: publicKey,
        onStatus: (status) => {
          if (status.stage === 'success') {
            toast.success('Bot renamed');
            setRenaming(false);
            queryClient.invalidateQueries({ queryKey: ['bots', publicKey] });
            queryClient.invalidateQueries({ queryKey: ['botDetails'] });
          } else if (status.stage === 'error') {
            toast.error(status.error || 'Rename failed');
          }
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Rename failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className="bot-card overflow-hidden"
      style={{ background: 'var(--card-2)', borderRadius: '20px', border: `1px solid ${meta.color}20` }}
    >
      {/* Tier color top stripe */}
      <div style={{ height: '3px', background: meta.color, opacity: 0.7 }} />

      <div style={{ padding: compact ? '16px' : '20px' }}>
        {/* Header row */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
              style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}35` }}
            >
              {meta.emoji}
            </div>
            <div>
              <div
                className="font-black text-sm uppercase tracking-wide"
                style={{ fontFamily: "'Sora', sans-serif", color: 'var(--text)' }}
              >
                {bot.nickname || bot.name || meta.tier}
              </div>
              <div className="text-xs font-mono" style={{ color: 'var(--muted)' }}>
                #{String(bot.id).padStart(4, '0')}
              </div>
            </div>
          </div>
          <span
            className="badge"
            style={{ background: `${meta.color}14`, color: meta.color, borderRadius: '8px', fontSize: '10px' }}
          >
            T{meta.index}
          </span>
        </div>

        {!compact && publicKey && bot.owner === publicKey && (
          renaming ? (
            <div className="mb-3 flex gap-2">
              <input
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bot nickname"
                className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs"
                style={{ background: 'var(--card)', border: '1px solid var(--liner)', color: 'var(--text)' }}
              />
              <button onClick={saveName} disabled={saving} className="text-xs font-bold" style={{ color: 'var(--green)' }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setRenaming(false)} className="text-xs" style={{ color: 'var(--muted)' }}>Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setRenaming(true)}
              className="mb-3 flex items-center gap-1 text-xs"
              style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <Pencil className="w-3 h-3" />
              {bot.nickname || bot.name ? 'Rename' : 'Set nickname'}
            </button>
          )
        )}

        {/* Rate */}
        <div className="flex items-center gap-1.5 mb-1">
          <Zap className="w-3.5 h-3.5" style={{ color: 'var(--green)' }} />
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            <span style={{ color: 'var(--green)', fontWeight: 700, fontFamily: "'Sora', sans-serif" }}>
              {meta.ratePerHour}
            </span>{' '}
            pts/hr
          </span>
        </div>

        {!compact && (
          <div className="flex items-center gap-1.5 mb-4">
            <Clock className="w-3 h-3" style={{ color: 'var(--muted)', opacity: 0.5 }} />
            <span className="text-xs" style={{ color: 'var(--muted)', opacity: 0.6 }}>Minted {mintDate}</span>
          </div>
        )}

        {onList && (
          <button
            onClick={() => onList(bot)}
            className="w-full mt-3 py-2 px-3 rounded-xl text-xs font-semibold transition-all"
            style={{ border: '1px solid var(--liner)', color: 'var(--muted)', background: 'transparent', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = meta.color;
              (e.currentTarget as HTMLElement).style.color = meta.color;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--liner)';
              (e.currentTarget as HTMLElement).style.color = 'var(--muted)';
            }}
          >
            List for Sale
          </button>
        )}
      </div>
    </motion.div>
  );
}
