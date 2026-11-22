/**
 * Tests for TierSupplyBadge component (#385 — optional per-tier mint caps).
 *
 * Acceptance criteria from the issue:
 *   ✓ Minting the last capped unit succeeds and the next fails
 *     → Badge shows "Sold out" when minted === cap
 *   ✓ Raising the cap re-opens minting
 *     → Badge shows remaining when cap > minted
 *   ✓ Lowering it below current supply fails
 *     → (contract-side; badge reflects new remaining)
 *   ✓ The frontend shows "12 / 100 remaining"
 *     → Badge renders correctly with those numbers
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import TierSupplyBadge from "../TierSupplyBadge";

const U64_MAX = BigInt("18446744073709551615");

describe("TierSupplyBadge (#385)", () => {
  // ── Uncapped (cap = 0 or sentinel) ──────────────────────────────────────────

  it("renders nothing when cap is 0n (uncapped)", () => {
    const { container } = render(
      <TierSupplyBadge minted={12n} cap={0n} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when cap is u64::MAX sentinel (uncapped)", () => {
    const { container } = render(
      <TierSupplyBadge minted={12n} cap={U64_MAX} />
    );
    expect(container.firstChild).toBeNull();
  });

  // ── Normal remaining state ───────────────────────────────────────────────────

  it('shows "12 / 100 remaining" for minted=12, cap=100', () => {
    render(<TierSupplyBadge minted={12n} cap={100n} />);
    const badge = screen.getByTestId("tier-supply-badge");
    expect(badge).toHaveTextContent("12");
    expect(badge).toHaveTextContent("100");
    expect(badge).toHaveTextContent("remaining");
  });

  it("has correct aria-label for screen readers", () => {
    render(<TierSupplyBadge minted={12n} cap={100n} />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveAttribute(
      "aria-label",
      "12 of 100 minted — 88 remaining"
    );
  });

  // ── Sold out ─────────────────────────────────────────────────────────────────

  it('shows "Sold out" when minted equals cap', () => {
    render(<TierSupplyBadge minted={100n} cap={100n} />);
    const badge = screen.getByTestId("tier-supply-badge");
    expect(badge).toHaveTextContent("Sold out");
  });

  it("has correct sold-out aria-label", () => {
    render(<TierSupplyBadge minted={100n} cap={100n} />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "100 / 100 minted — Sold out"
    );
  });

  it("shows sold out even if minted somehow exceeds cap (defensive)", () => {
    render(<TierSupplyBadge minted={105n} cap={100n} />);
    expect(screen.getByTestId("tier-supply-badge")).toHaveTextContent("Sold out");
  });

  // ── Urgency styling ───────────────────────────────────────────────────────────

  it("applies urgency styling when <=10% remaining", () => {
    // 9 out of 100 = 9% remaining → urgent
    render(<TierSupplyBadge minted={91n} cap={100n} />);
    const badge = screen.getByTestId("tier-supply-badge");
    // Urgency: amber classes present in className
    expect(badge.className).toContain("amber");
  });

  it("does not apply urgency styling when >10% remaining", () => {
    // 50 out of 100 = 50% remaining → normal
    render(<TierSupplyBadge minted={50n} cap={100n} />);
    const badge = screen.getByTestId("tier-supply-badge");
    expect(badge.className).not.toContain("amber");
    expect(badge.className).not.toContain("red-4");
  });

  it("applies sold-out styling when cap is fully consumed", () => {
    render(<TierSupplyBadge minted={100n} cap={100n} />);
    const badge = screen.getByTestId("tier-supply-badge");
    expect(badge.className).toContain("red");
  });

  // ── Edge cases ────────────────────────────────────────────────────────────────

  it("handles cap of 1 with 0 minted", () => {
    render(<TierSupplyBadge minted={0n} cap={1n} />);
    expect(screen.getByTestId("tier-supply-badge")).toHaveTextContent("0 / 1");
    expect(screen.getByTestId("tier-supply-badge")).toHaveTextContent("remaining");
  });

  it("handles the last slot (1 remaining)", () => {
    render(<TierSupplyBadge minted={99n} cap={100n} />);
    const badge = screen.getByTestId("tier-supply-badge");
    expect(badge).toHaveTextContent("99");
    expect(badge).toHaveTextContent("100");
    // 1 remaining of 100 = 1% → urgent
    expect(badge.className).toContain("amber");
  });

  it("accepts a custom className", () => {
    render(<TierSupplyBadge minted={12n} cap={100n} className="my-custom-class" />);
    expect(screen.getByTestId("tier-supply-badge").className).toContain("my-custom-class");
  });

  // ── When cap is raised (re-opens minting) ────────────────────────────────────

  it("re-renders correctly when cap is raised above minted (re-opens minting)", () => {
    const { rerender } = render(<TierSupplyBadge minted={100n} cap={100n} />);
    expect(screen.getByTestId("tier-supply-badge")).toHaveTextContent("Sold out");

    // Admin raises cap from 100 to 150
    rerender(<TierSupplyBadge minted={100n} cap={150n} />);
    expect(screen.getByTestId("tier-supply-badge")).not.toHaveTextContent("Sold out");
    expect(screen.getByTestId("tier-supply-badge")).toHaveTextContent("100");
    expect(screen.getByTestId("tier-supply-badge")).toHaveTextContent("150");
    expect(screen.getByTestId("tier-supply-badge")).toHaveTextContent("remaining");
  });
});
