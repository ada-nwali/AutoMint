'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Zap, Trophy, ShoppingBag, ArrowRight, Check, Bot, Coins,
  Cpu, Star, Gem, Layers, Globe, Lock, TrendingUp,
} from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';

const LIVE_STATS = [
  { label: 'Bots Deployed',   value: '3,241',   color: 'var(--green)' },
  { label: 'Total $AMT Mined',value: '847K',     color: 'var(--gold)' },
  { label: 'P2P Volume (XLM)',value: '92,400',   color: 'var(--purple)' },
  { label: 'Active Miners',   value: '1,089',    color: 'var(--blue)' },
];

// Each tier's icon and accent
const BOT_TIER_CARDS = [
  { label: 'Basic',   icon: Bot,   color: '#9a8f81', rate: '1' },
  { label: 'Silver',  icon: Cpu,   color: '#5bb8ff', rate: '25' },
  { label: 'Gold',    icon: Star,  color: '#ffcf4d', rate: '100' },
  { label: 'Diamond', icon: Gem,   color: '#9d7bff', rate: '500' },
];

const HOW_IT_WORKS = [
  { step: 1, icon: Globe,     title: 'Connect Wallet',    desc: 'Link your Freighter wallet. No seed phrases, no custody risk.' },
  { step: 2, icon: Bot,       title: 'Claim Free Bot',    desc: 'Register and instantly receive a Basic Bot that starts accruing points.' },
  { step: 3, icon: TrendingUp,title: 'Auto-Earn Points',  desc: 'Points accrue every second based on your fleet — no tapping required.' },
  { step: 4, icon: Coins,     title: 'Claim $AMT',        desc: 'Convert points to $AMT on-chain. Full Soroban contract, fully transparent.' },
];

const FEATURES = [
  'Bot NFTs are on-chain assets — own them forever',
  'Points accrue 24/7, even when your browser is closed',
  'P2P bot marketplace with trustless escrow',
  'Global leaderboard stored on Stellar',
  'Near-zero fees — fractions of a cent per transaction',
  'Fully open-source Soroban contracts',
];

export default function LandingPage() {
  const { isConnected, connect, status } = useWallet();

  return (
    <div style={{ background: 'var(--bg)' }}>

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-20 pb-28">
        <div className="hero-glow absolute inset-0 pointer-events-none" />

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="text-center"
          >
            {/* Live badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-8 text-xs font-bold uppercase tracking-widest"
              style={{ background: 'rgba(52,224,138,0.1)', color: 'var(--green)', border: '1px solid rgba(52,224,138,0.22)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: 'var(--green)' }} />
              Live on Stellar Testnet
            </div>

            <h1 className="memefi-h1 mb-5">
              Idle Bot Mining<br />
              <span style={{ color: 'var(--gold)' }}>on Stellar</span>
            </h1>

            <p className="max-w-xl mx-auto mb-10 text-sm sm:text-base"
              style={{ color: 'var(--muted)', lineHeight: 1.7 }}
            >
              Deploy NFT Bots that auto-accumulate{' '}
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>$AMT tokens</span>{' '}
              every second via Soroban smart contracts. No tapping. Pure passive earnings on-chain.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-16">
              {isConnected ? (
                <Link href="/dashboard">
                  <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="btn-primary">
                    Open Dashboard <ArrowRight className="w-4 h-4" />
                  </motion.button>
                </Link>
              ) : (
                <motion.button
                  onClick={connect}
                  disabled={status === 'connecting'}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  className="btn-primary"
                >
                  <Zap className="w-4 h-4" />
                  {status === 'connecting' ? 'Connecting…' : 'Start Earning Free'}
                </motion.button>
              )}
              <Link href="/leaderboard">
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  className="btn-ghost"
                >
                  <Trophy className="w-4 h-4" /> View Leaderboard
                </motion.button>
              </Link>
            </div>

            {/* Floating bot tier cards */}
            <div className="flex justify-center items-end gap-4 sm:gap-6">
              {BOT_TIER_CARDS.map(({ label, icon: Icon, color, rate }, i) => (
                <motion.div
                  key={label}
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 3.2 + i * 0.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
                  className="flex flex-col items-center gap-2"
                >
                  <div
                    className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center"
                    style={{
                      background: `${color}14`,
                      border: `1px solid ${color}30`,
                      boxShadow: `0 8px 32px ${color}20`,
                    }}
                  >
                    <Icon className="w-7 h-7" style={{ color }} />
                  </div>
                  <div className="text-center">
                    <div className="text-xs font-black uppercase" style={{ fontFamily: "'Sora', sans-serif", color }}>{label}</div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>{rate}/hr</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Live stats band ────────────────────────────────────────────────────── */}
      <section style={{ borderTop: '1px solid var(--liner)', borderBottom: '1px solid var(--liner)', background: 'var(--card)' }} className="py-8">
        <div className="max-w-5xl mx-auto px-4 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {LIVE_STATS.map(({ label, value, color }) => (
            <div key={label}>
              <div className="font-black" style={{ fontFamily: "'Sora', sans-serif", fontSize: '22px', color, letterSpacing: '-0.5px' }}>{value}</div>
              <div className="text-xs font-semibold tracking-wider uppercase mt-1" style={{ color: 'var(--muted)' }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────────── */}
      <section className="py-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="memefi-h2 mb-3">How it Works</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Four steps from zero to earning</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {HOW_IT_WORKS.map(({ step, icon: Icon, title, desc }, i) => (
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="mf-card flex flex-col gap-4"
              style={{ padding: '24px', borderRadius: '20px' }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'var(--card-2)' }}
                >
                  <Icon className="w-5 h-5" style={{ color: 'var(--green)' }} />
                </div>
                <span className="badge badge-muted">Step {step}</span>
              </div>
              <div>
                <h3 className="memefi-h3 mb-1.5">{title}</h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Bot tiers ─────────────────────────────────────────────────────────── */}
      <section style={{ background: 'var(--card)', borderTop: '1px solid var(--liner)', borderBottom: '1px solid var(--liner)' }} className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="memefi-h2 mb-3">Bot Tiers</h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Upgrade your fleet for exponentially higher returns</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              { label: 'Basic',   icon: Bot,    color: '#9a8f81', rate: 1,   price: 0 },
              { label: 'Bronze',  icon: Layers,  color: '#cd7f32', rate: 5,   price: 500 },
              { label: 'Silver',  icon: Cpu,     color: '#5bb8ff', rate: 25,  price: 2000 },
              { label: 'Gold',    icon: Star,    color: '#ffcf4d', rate: 100, price: 7500 },
              { label: 'Diamond', icon: Gem,     color: '#9d7bff', rate: 500, price: 25000 },
            ].map(({ label, icon: Icon, color, rate, price }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                whileHover={{ y: -4 }}
                className="mf-card-2 text-center cursor-default"
                style={{ padding: '20px 14px', borderRadius: '20px', border: `1px solid ${color}20` }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3"
                  style={{ background: `${color}12` }}
                >
                  <Icon className="w-5 h-5" style={{ color }} />
                </div>
                <div className="text-xs font-black uppercase tracking-wider mb-2" style={{ fontFamily: "'Sora', sans-serif", color }}>
                  {label}
                </div>
                <div className="font-black mb-0.5" style={{ fontFamily: "'Sora', sans-serif", fontSize: '22px', color: price === 0 ? 'var(--text)' : 'var(--gold)', lineHeight: 1 }}>
                  {rate}
                </div>
                <div className="text-xs mb-3" style={{ color: 'var(--muted)' }}>pts/hour</div>
                <div className="text-xs font-bold pt-2.5" style={{ borderTop: '1px solid var(--liner)', color: price === 0 ? 'var(--green)' : 'var(--gold)' }}>
                  {price === 0 ? 'FREE' : `${price.toLocaleString()} XLM`}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────────── */}
      <section className="py-20 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-2 gap-14 items-center">
          <div>
            <h2 className="memefi-h2 mb-5">Built for the Stellar Ecosystem</h2>
            <p className="mb-7 text-sm" style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
              AutoMint uses Soroban smart contracts and Stellar&apos;s near-zero fees to make idle gaming economically viable — even for micro-rewards.
            </p>
            <ul className="space-y-2.5">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm">
                  <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: 'rgba(52,224,138,0.12)' }}
                  >
                    <Check className="w-2.5 h-2.5" style={{ color: 'var(--green)' }} />
                  </div>
                  <span style={{ color: 'var(--text)' }}>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Bot,         label: 'NFT Bots',     desc: 'Tradeable on-chain assets',   color: 'var(--green)' },
              { icon: Zap,         label: 'Auto-Accrual', desc: '24/7 passive point earning',  color: 'var(--gold)' },
              { icon: ShoppingBag, label: 'Marketplace',  desc: 'P2P bot trading with escrow', color: 'var(--purple)' },
              { icon: Lock,        label: 'Non-Custodial',desc: 'Your keys, your bots, always',color: 'var(--blue)' },
            ].map(({ icon: Icon, label, desc, color }) => (
              <div key={label} className="mf-card" style={{ padding: '20px', borderRadius: '18px' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: `${color}14` }}>
                  <Icon className="w-4 h-4" style={{ color }} />
                </div>
                <div className="font-bold text-xs mb-1 uppercase tracking-wide" style={{ color: 'var(--text)', fontFamily: "'Sora', sans-serif" }}>{label}</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────────── */}
      <section className="pb-24 max-w-5xl mx-auto px-4">
        <div
          className="rounded-3xl p-10 sm:p-14 text-center relative overflow-hidden"
          style={{ background: 'var(--card)' }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse 60% 60% at 50% 100%, rgba(255,207,77,0.07) 0%, transparent 100%)' }}
          />
          <div className="relative">
            <h2 className="memefi-h2 mb-3">
              Ready to Start{' '}
              <span style={{ color: 'var(--gold)' }}>Earning?</span>
            </h2>
            <p className="mb-8 max-w-md mx-auto text-sm" style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
              Connect your Freighter wallet and claim your free Basic Bot in under 60 seconds.
            </p>
            {isConnected ? (
              <Link href="/dashboard">
                <button className="btn-primary">
                  Open Dashboard <ArrowRight className="w-4 h-4" />
                </button>
              </Link>
            ) : (
              <button onClick={connect} className="btn-primary">
                Get Started — It&apos;s Free
              </button>
            )}
          </div>
        </div>
      </section>

    </div>
  );
}
