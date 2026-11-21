'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, TrendingUp } from 'lucide-react';
import { formatPoints, TIER_META } from '@/types';
import type { BotNFT } from '@/types';

interface PointsCounterProps {
  displayedPoints: number;
  ratePerHour: number;
  bots: BotNFT[];
  amtBalance: bigint;
  secondsToNextAmt?: bigint | null;
}

export function PointsCounter({ displayedPoints, ratePerHour, bots, amtBalance, secondsToNextAmt }: PointsCounterProps) {
  const ratePerSec = (ratePerHour / 3600).toFixed(4);
  const countdown = secondsToNextAmt == null
    ? null
    : formatCountdown(Number(secondsToNextAmt));

  return (
    <div className="mf-card relative overflow-hidden" style={{ padding: '32px', background: 'var(--card)' }}>
      {/* Subtle gold glow top-right */}
      <div
        className="absolute -top-8 -right-8 w-48 h-48 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(255,207,77,0.08) 0%, transparent 70%)' }}
      />

      <div className="relative">
        {/* Label */}
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4" style={{ color: 'var(--gold)' }} />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
            Total Points
          </span>
        </div>

        {/* Counter */}
        <AnimatePresence mode="wait">
          <motion.div
            key={Math.floor(displayedPoints / 10)}
            initial={{ opacity: 0.8, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            className="counter-digit"
            style={{ fontSize: 'clamp(48px, 7vw, 72px)', color: 'var(--gold)', lineHeight: 1 }}
          >
            {displayedPoints.toLocaleString()}
          </motion.div>
        </AnimatePresence>

        <p className="text-xs mt-2 font-mono" style={{ color: 'var(--muted)' }}>
          +{ratePerSec} pts/sec
        </p>
        {countdown && (
          <p className="text-xs mt-1" style={{ color: 'var(--gold)' }}>
            Next AMT in {countdown}
          </p>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mt-6">
          <StatBox label="Bots"       value={String(bots.length)}                    color="var(--text)" />
          <StatBox label="Rate / hr"  value={formatPoints(ratePerHour)}              color="var(--green)" />
          <StatBox label="$AMT Earned" value={Number(amtBalance).toLocaleString()}   color="var(--gold)" />
        </div>

        {/* Bot breakdown */}
        {bots.length > 0 && (
          <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--liner)' }}>
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-3.5 h-3.5" style={{ color: 'var(--muted)' }} />
              <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--muted)' }}>Bot breakdown</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {bots.map((bot) => {
                const meta = TIER_META[bot.tier];
                return (
                  <div
                    key={String(bot.id)}
                    className="badge"
                    style={{ background: `${meta.color}14`, color: meta.color, borderRadius: '8px' }}
                  >
                    {meta.emoji} {meta.label} <span style={{ opacity: 0.6 }}>+{meta.ratePerHour}/h</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatCountdown(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'less than 1m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="mf-card-2 text-center" style={{ padding: '14px 10px', borderRadius: '14px' }}>
      <div className="text-xs uppercase tracking-widest font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="font-black text-base font-display" style={{ fontFamily: "'Sora', sans-serif", color }}>{value}</div>
    </div>
  );
}
