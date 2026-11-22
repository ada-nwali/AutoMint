#!/usr/bin/env node
/**
 * Performance budget gate for the landing page bundle.
 *
 * Reads the Next.js build manifest produced by `next build` and computes
 * the total First Load JS for a given route (default: the root landing
 * page `/`), then fails the process (non-zero exit code) if that total
 * exceeds the configured budget.
 *
 * The landing page is intentionally excluded from pulling in
 * @stellar/stellar-sdk (see src/app/page.tsx and src/hooks/useWallet.ts,
 * which use the much lighter @stellar/freighter-api instead). Wallet /
 * on-chain heavy pages (dashboard, marketplace, profile) are allowed to
 * exceed this budget since they need the SDK.
 *
 * Usage:
 *   node scripts/check-bundle-size.js
 *   node scripts/check-bundle-size.js --route=/ --budget=250
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, ".next");

function parseArgs() {
  const args = { route: "/", budgetKb: 250 };
  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "route") args.route = value;
    if (key === "budget") args.budgetKb = Number(value);
  }
  return args;
}

/**
 * Next.js writes a per-build app-path routes manifest under
 * `.next/app-build-manifest.json` mapping each route to the list of JS
 * chunks it loads, and `.next/build-manifest.json` for the pages router
 * equivalent. We read the app-build-manifest (this repo uses the App
 * Router) and sum the gzip-on-disk size of each chunk referenced by the
 * target route, plus the shared root layout chunks.
 */
function loadManifest() {
  const appManifestPath = path.join(BUILD_DIR, "app-build-manifest.json");
  if (!fs.existsSync(appManifestPath)) {
    console.error(
      `Could not find ${appManifestPath}. Run "next build" before running this script.`,
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(appManifestPath, "utf8"));
}

function routeKeyFor(route) {
  // app-build-manifest.json keys pages as "<route>/page", root is "/page".
  const normalized = route === "/" ? "" : route.replace(/^\/|\/$/g, "");
  return normalized ? `${normalized}/page` : "/page";
}

function gzipSizeOf(filePath) {
  const zlib = require("zlib");
  const contents = fs.readFileSync(filePath);
  return zlib.gzipSync(contents).length;
}

function main() {
  const { route, budgetKb } = parseArgs();
  const manifest = loadManifest();
  const key = routeKeyFor(route);
  const pages = manifest.pages || {};
  const chunks = pages[key];

  if (!chunks) {
    console.error(
      `Route "${route}" (key "${key}") not found in app-build-manifest.json. Known routes: ${Object.keys(
        pages,
      ).join(", ")}`,
    );
    process.exit(1);
  }

  let totalBytes = 0;
  const breakdown = [];
  for (const chunk of chunks) {
    if (!chunk.endsWith(".js")) continue;
    const chunkPath = path.join(BUILD_DIR, chunk);
    if (!fs.existsSync(chunkPath)) continue;
    const size = gzipSizeOf(chunkPath);
    totalBytes += size;
    breakdown.push({ chunk, kb: (size / 1024).toFixed(1) });
  }

  const totalKb = totalBytes / 1024;

  console.log(`Bundle budget check for route "${route}"`);
  console.log(`Budget: ${budgetKb} KB gzipped`);
  console.log(`Actual: ${totalKb.toFixed(1)} KB gzipped`);
  console.log("");
  console.log("Chunk breakdown:");
  for (const b of breakdown) {
    console.log(`  ${b.chunk}: ${b.kb} KB`);
  }

  // Guard against a manifest that resolved but contained zero measurable
  // JS chunks (e.g. a route rename) — that's a signal the check itself is
  // broken, not that the budget passed.
  if (breakdown.length === 0) {
    console.error(
      "No JS chunks were measured for this route — the check itself may be misconfigured.",
    );
    process.exit(1);
  }

  if (totalKb > budgetKb) {
    console.error(
      `\nFAIL: landing page JS payload (${totalKb.toFixed(
        1,
      )} KB gzipped) exceeds the ${budgetKb} KB budget.`,
    );
    process.exit(1);
  }

  console.log(`\nPASS: within budget (${(budgetKb - totalKb).toFixed(1)} KB to spare).`);
}

main();
