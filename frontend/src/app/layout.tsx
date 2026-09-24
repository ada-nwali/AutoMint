import type { Metadata } from "next";
import { Sora, Inter } from "next/font/google";
import Providers from "./providers";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  variable: "--memefi-font-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--memefi-font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AutoMint — Mint, Earn & Trade AI Bot NFTs on Stellar",
  description:
    "Mint AI-powered bot NFTs on Stellar, earn points through daily accrual, and trade on the marketplace.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${inter.variable}`}>
      <body className="flex min-h-screen flex-col bg-bg font-sans text-text">
        <Providers>
          <ErrorBoundary>
            {/* Skip link: first focusable element, visible on focus.
                Allows keyboard users to bypass the header navigation
                and jump directly to the main content area. */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-gold focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-bg focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-bg"
            >
              Skip to main content
            </a>
            <Header />
            <main id="main-content" className="flex-1" tabIndex={-1}>
              {children}
            </main>
            <Footer />
          </ErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}
