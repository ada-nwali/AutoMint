"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Bot, TrendingUp, Shield, Zap, ArrowRight, Users, Activity, Star } from "lucide-react";
import { TIER_META, type BotTier } from "@/types";
import { useTiers } from "@/hooks/useTiers";
import { stroopsToXlmString } from "@/lib/format";

const tiers: BotTier[] = ["Basic", "Bronze", "Silver", "Gold", "Diamond"];

const stats = [
  { label: "Bots Minted", value: "12,480", icon: Bot },
  { label: "Active Users", value: "3,200+", icon: Users },
  { label: "Points Distributed", value: "1.2M", icon: Activity },
  { label: "Uptime", value: "99.9%", icon: Shield },
];

const steps = [
  {
    step: "01",
    title: "Connect Wallet",
    description: "Link your Stellar wallet to get started in seconds.",
  },
  {
    step: "02",
    title: "Mint a Bot",
    description: "Choose a tier and mint your AI bot NFT on-chain.",
  },
  {
    step: "03",
    title: "Earn Points",
    description: "Your bot accrues points daily based on its tier.",
  },
  {
    step: "04",
    title: "Trade & Upgrade",
    description: "List on the marketplace or upgrade to a higher tier.",
  },
];

const features = [
  {
    icon: Zap,
    title: "Instant Settlement",
    description: "All transactions settle on Stellar in under 5 seconds.",
  },
  {
    icon: Shield,
    title: "On-Chain Ownership",
    description: "Your bots are NFTs — fully owned, transferable, and verifiable.",
  },
  {
    icon: TrendingUp,
    title: "Daily Accrual",
    description: "Higher-tier bots earn more points every day automatically.",
  },
  {
    icon: Star,
    title: "Tier Progression",
    description: "Upgrade from Basic to Diamond and multiply your earnings.",
  },
];

export default function HomePage() {
  // Rates and prices come from the bot_nft contract (#478); only colour and
  // emoji are client-side.
  const { data: tierInfo } = useTiers();

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden px-6 py-24 md:py-32">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -20%, var(--memefi-hero-glow-start), transparent), radial-gradient(ellipse 60% 40% at 70% 10%, var(--memefi-hero-glow-mid), transparent)",
          }}
        />
        <div className="relative mx-auto max-w-4xl text-center">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="font-display text-4xl font-extrabold leading-tight tracking-tight md:text-6xl"
          >
            Mint, Earn & Trade
            <br />
            <span className="text-gold">AI Bot NFTs</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mx-auto mt-6 max-w-2xl text-lg text-muted md:text-xl"
          >
            The first AI bot NFT platform on Stellar. Mint unique bots, earn
            points daily, and trade on a decentralized marketplace.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-4"
          >
            <Link href="/dashboard" className="btn-primary text-base">
              Launch App <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#tiers"
              className="rounded-xl border border-liner px-6 py-3 text-sm font-semibold text-muted hover:border-text/30 hover:text-text transition-all"
            >
              View Tiers
            </a>
          </motion.div>
        </div>
      </section>

      {/* Stats band */}
      <section className="border-y border-liner bg-card">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 py-10 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-2 text-center">
              <stat.icon className="h-5 w-5 text-gold" />
              <span className="font-display text-2xl font-bold text-text">
                {stat.value}
              </span>
              <span className="text-xs text-muted">{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Bot tier showcase */}
      <section id="tiers" className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center font-display text-3xl font-bold md:text-4xl">
            Choose Your <span className="text-gold">Bot Tier</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-muted">
            Higher tiers earn more points per day and unlock exclusive
            marketplace features.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {tiers.map((tier) => {
              const meta = TIER_META[tier];
              const info = tierInfo?.[tier];
              return (
                <div
                  key={tier}
                  className="mf-card flex flex-col items-center gap-3 text-center"
                >
                  <span className="text-4xl">{meta.emoji}</span>
                  <h3 className={`font-display text-lg font-bold ${meta.color}`}>
                    {tier}
                  </h3>
                  <p className="text-sm text-muted">
                    {info ? `${info.rate}x` : "—"} accrual rate
                  </p>
                  <p className="font-display text-xl font-bold text-text">
                    {!info
                      ? "—"
                      : info.price === 0n
                        ? "Free"
                        : `${stroopsToXlmString(info.price)} XLM`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-liner bg-card px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center font-display text-3xl font-bold md:text-4xl">
            How It <span className="text-purple">Works</span>
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-4">
            {steps.map((s) => (
              <div key={s.step} className="flex flex-col items-center gap-3 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/10 font-display text-lg font-bold text-gold">
                  {s.step}
                </span>
                <h3 className="font-display text-lg font-bold text-text">
                  {s.title}
                </h3>
                <p className="text-sm text-muted">{s.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center font-display text-3xl font-bold md:text-4xl">
            Built for <span className="text-green">Performance</span>
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {features.map((f) => (
              <div key={f.title} className="mf-card flex gap-4">
                <f.icon className="mt-1 h-6 w-6 shrink-0 text-gold" />
                <div>
                  <h3 className="font-display text-base font-bold text-text">
                    {f.title}
                  </h3>
                  <p className="mt-1 text-sm text-muted">{f.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-liner bg-card px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold md:text-4xl">
            Ready to <span className="text-gold">Mint</span>?
          </h2>
          <p className="mt-4 text-muted">
            Join thousands of users earning points with AI bot NFTs on Stellar.
          </p>
          <Link href="/dashboard" className="btn-primary mt-8 inline-flex text-base">
            Get Started <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
