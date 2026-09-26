import { Github, ExternalLink } from "lucide-react";
import { NETWORK } from "@/lib/constants";

const REPO_URL = "https://github.com/Ada-Girly881/AutoMint";

const footerLinks = {
  product: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Marketplace", href: "/marketplace" },
    { label: "Leaderboard", href: "/leaderboard" },
  ],
  resources: [
    { label: "Project Docs", href: `${REPO_URL}/tree/testnet-implementation/docs`, external: true },
    { label: "Deployment Guide", href: `${REPO_URL}/blob/testnet-implementation/docs/DEPLOYMENT.md`, external: true },
    { label: "Stellar Testnet Explorer", href: "https://stellar.expert/explorer/testnet", external: true },
    { label: "Soroban Docs", href: "https://soroban.stellar.org/docs", external: true },
    {
      label: "License (Apache-2.0)",
      href: `${REPO_URL}/blob/testnet-implementation/LICENSE`,
      external: true,
    },
  ],
  community: [
    {
      label: "GitHub",
      href: REPO_URL,
      external: true,
      icon: Github,
    },
  ],
};

function FooterLinkGroup({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string; external?: boolean; icon?: React.ElementType }[];
}) {
  return (
    <nav aria-label={title} className="flex flex-col gap-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              aria-label={link.external ? `${link.label} (opens in new tab)` : link.label}
              className="inline-flex items-center gap-1.5 text-sm text-text/70 hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm"
            >
              {link.icon && <link.icon className="h-3.5 w-3.5 shrink-0" />}
              {link.label}
              {link.external && <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function Footer() {
  return (
    <footer className="border-t border-liner bg-card" role="contentinfo">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <h2 className="font-display text-lg font-bold text-text">AutoMint</h2>
            <p className="mt-2 text-sm text-muted leading-relaxed">
              Mint, earn, and trade AI bot NFTs on Stellar.
            </p>
          </div>

          <FooterLinkGroup title="Product" links={footerLinks.product} />
          <FooterLinkGroup title="Resources" links={footerLinks.resources} />
          <FooterLinkGroup title="Community" links={footerLinks.community} />
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-liner pt-6 sm:flex-row">
          <p className="text-xs text-muted">
            &copy; {new Date().getFullYear()} AutoMint. All rights reserved.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-xs text-muted">
            <span>Built on</span>
            <a
              href="https://stellar.org"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Stellar (opens in new tab)"
              className="font-medium text-blue hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm"
            >
              Stellar
            </a>
            <span aria-hidden="true">+</span>
            <a
              href="https://soroban.stellar.org"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Soroban (opens in new tab)"
              className="font-medium text-purple hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded-sm"
            >
              Soroban
            </a>
            <span className="mx-1 text-muted" aria-hidden="true">
              &middot;
            </span>
            <span>Network: {NETWORK}</span>
            <span aria-hidden="true">+</span>
            <span>React</span>
            <span aria-hidden="true">+</span>
            <span>Next.js</span>
            <span aria-hidden="true">+</span>
            <span>Tailwind CSS</span>
          </div>
        </div>
      </div>
    </footer>
  );
}