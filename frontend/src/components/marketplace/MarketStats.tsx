"use client";

import { useMarketStats } from "@/hooks/useMarketplace";
import { stroopsToXlmString } from "@/lib/format";

function amount(value: bigint): string {
  return `${Number(stroopsToXlmString(value)).toLocaleString("en-US", { maximumFractionDigits: 7 })} XLM`;
}

/**
 * Per-tier volume and floor price (#432), so a buyer can judge whether a price
 * is fair. Renders nothing while loading or on error: the listings below stay
 * usable without it.
 */
export default function MarketStats() {
  const { data } = useMarketStats();
  if (!data || data.length === 0) return null;

  return (
    <div
      className="mb-6 overflow-x-auto rounded-xl border border-liner bg-card"
      data-testid="market-stats"
    >
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Marketplace volume and floor price per tier</caption>
        <thead>
          <tr className="border-b border-liner text-xs uppercase tracking-wider text-muted">
            <th scope="col" className="px-4 py-2">Tier</th>
            <th scope="col" className="px-4 py-2 text-right">Floor</th>
            <th scope="col" className="px-4 py-2 text-right">Volume</th>
            <th scope="col" className="px-4 py-2 text-right">Sales</th>
            <th scope="col" className="px-4 py-2 text-right">Last sale</th>
          </tr>
        </thead>
        <tbody>
          {data.map((stats) => (
            <tr key={stats.tier} data-testid={`market-stats-${stats.tier}`} className="border-b border-liner last:border-0">
              <th scope="row" className="px-4 py-2 font-medium text-text">{stats.tier}</th>
              <td className="px-4 py-2 text-right text-text">
                {stats.floor_price > 0n ? amount(stats.floor_price) : "—"}
              </td>
              <td className="px-4 py-2 text-right text-text">{amount(stats.volume)}</td>
              <td className="px-4 py-2 text-right text-text">{stats.sale_count.toString()}</td>
              <td className="px-4 py-2 text-right text-text">
                {stats.last_sale_price > 0n ? amount(stats.last_sale_price) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
