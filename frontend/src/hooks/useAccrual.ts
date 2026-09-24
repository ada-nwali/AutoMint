import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getAccrualState,
  getUserProfile,
  isRegistered,
  getUserBots,
  getAmtBalance,
  getAmtDecimals,
  getUserTotalRate,
} from "@/lib/contracts";
import { executeTransaction, type TransactionStatus } from "@/lib/transaction";
import { getLedgerCloseTime } from "@/lib/stellar";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import { useState, useEffect, useRef } from "react";
import { nativeToScVal } from "@stellar/stellar-sdk";
import type { AccrualState, UserProfile } from "@/types";
import { pollWhenVisible } from "@/lib/polling";
import { STALE_TIME, GC_TIME, qk, DASHBOARD_POLL_MS } from "@/lib/queryKeys";
import { trackStatus, newTxId } from "@/components/ui/TxStatus";

const BASIC_BOT_RATE = 1; // Basic bot accrual rate
const UPDATE_INTERVAL = 1000; // Update every second
const POINTS_PER_HOUR_DIVISOR = 3600; // Seconds in an hour

/** Identifiers for the three on-chain registration steps. */
export type RegisterStepId = "register" | "mint" | "accrual";

export interface RegisterStep {
  id: RegisterStepId;
  /** Toast/UI label for the step. */
  label: string;
}

/**
 * The registration pipeline, in order (#452).
 *
 * Exported so the banner can render a stable three-step progress UI and
 * tests can assert which steps ran.
 */
export const REGISTER_STEPS: readonly RegisterStep[] = [
  { id: "register", label: "Registering user" },
  { id: "mint", label: "Minting basic bot" },
  { id: "accrual", label: "Starting accrual" },
] as const;

export interface RegisterProgress {
  /** Index into {@link REGISTER_STEPS} of the step currently running. */
  stepIndex: number;
  /** Running step, or `"done"` once every remaining step has confirmed. */
  step: RegisterStepId | "done";
}

export function useRegister() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);
  const [progress, setProgress] = useState<RegisterProgress | null>(null);

  const mutation = useMutation({
    mutationFn: async (username: string) => {
      if (!publicKey) throw new Error("Wallet not connected");
      setProgress(null);

      const REGISTRY_CONTRACT_ID = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID || "";
      const BOT_NFT_CONTRACT_ID = process.env.NEXT_PUBLIC_BOT_NFT_CONTRACT_ID || "";
      const ACCRUAL_CONTRACT_ID = process.env.NEXT_PUBLIC_ACCRUAL_CONTRACT_ID || "";

      // Resume detection (#452): read the three on-chain facts in parallel
      // and only run the steps that have not landed yet. A registration
      // interrupted after step 1 (or 2) used to restart from step 1 and die
      // on the registry's already-registered error, trapping the user.
      const [registeredOnChain, bots, accrualState] = await Promise.all([
        isRegistered(publicKey),
        getUserBots(publicKey),
        getAccrualState(publicKey),
      ]);

      const remaining = REGISTER_STEPS.filter((step) => {
        switch (step.id) {
          case "register":
            return !registeredOnChain;
          case "mint":
            return bots.length === 0;
          case "accrual":
            return !accrualState;
          default:
            return false;
        }
      });

      // Helper to execute a transaction and handle toast updates
      const executeStep = async (
        label: string,
        contractId: string,
        method: string,
        args: any[]
      ) => {
        return new Promise((resolve, reject) => {
          executeTransaction({
            contractId,
            method,
            args,
            sourceAddress: publicKey,
            onStatus: (status: TransactionStatus) => {
              switch (status.stage) {
                case "building":
                  toast.loading(`${label}: Building transaction...`, { id: label });
                  break;
                case "simulating":
                  toast.loading(`${label}: Simulating...`, { id: label });
                  break;
                case "signing":
                  toast.loading(`${label}: Waiting for wallet signature...`, {
                    id: label,
                  });
                  break;
                case "submitting":
                  toast.loading(`${label}: Submitting to blockchain...`, {
                    id: label,
                  });
                  break;
                case "polling":
                  toast.loading(`${label}: Confirming on-chain... (${status.hash?.slice(0, 8)})`, {
                    id: label,
                  });
                  break;
                case "success":
                  toast.success(
                    `${label}: Complete!
                     ${status.explorerUrl ? `View on explorer` : ""}`.trim(),
                    {
                      id: label,
                      action: status.explorerUrl
                        ? {
                            label: "View",
                            onClick: () => window.open(status.explorerUrl, "_blank"),
                          }
                        : undefined,
                    }
                  );
                  resolve(status);
                  break;
                case "error":
                  toast.error(`${label}: ${status.error || "Unknown error"}`, {
                    id: label,
                  });
                  reject(new Error(`${label} failed: ${status.error}`));
                  break;
              }
            },
          }).catch(reject);
        });
      };

      // Steps run strictly sequentially — each executeStep awaits on-chain
      // confirmation before the next step builds its transaction.
      for (const step of remaining) {
        const stepIndex = REGISTER_STEPS.findIndex((s) => s.id === step.id);
        setProgress({ stepIndex, step: step.id });

        switch (step.id) {
          case "register":
            await executeStep(
              step.label,
              REGISTRY_CONTRACT_ID,
              "register",
              [
                nativeToScVal(publicKey, { type: "address" }),
                nativeToScVal(username, { type: "string" }),
              ]
            );
            break;
          case "mint":
            await executeStep(
              step.label,
              BOT_NFT_CONTRACT_ID,
              "mint_basic",
              [nativeToScVal(publicKey, { type: "address" })]
            );
            break;
          case "accrual":
            await executeStep(
              step.label,
              ACCRUAL_CONTRACT_ID,
              "start_accrual",
              [
                nativeToScVal(publicKey, { type: "address" }),
                nativeToScVal(BASIC_BOT_RATE, { type: "u32" }),
              ]
            );
            break;
        }
      }

      setProgress({ stepIndex: REGISTER_STEPS.length, step: "done" });
      return { success: true };
    },
    onSuccess: () => {
      // Every step already awaited finality, so invalidate immediately —
      // the old 2-second blind delay left the dashboard stale (#452).
      queryClient.invalidateQueries({ queryKey: qk.registered(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.accrualState(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.bots(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["botDetails"] });
      queryClient.invalidateQueries({ queryKey: qk.profile(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.dashboard(publicKey) });
      toast.success("Registration complete! Welcome to AutoMint!");
    },
    onError: (error: Error) => {
      // onStatus callbacks already handle error toasts
      console.error("Registration failed:", error);
    },
  });

  return { ...mutation, progress };
}

/** Whether the connected wallet address is registered in the registry contract. */
export function useRegistered() {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery<boolean>({
    queryKey: qk.registered(publicKey),
    queryFn: () =>
      publicKey ? isRegistered(publicKey) : Promise.resolve(false),
    enabled: !!publicKey,
    // Poll from one constant, and pause entirely when the tab is hidden (#495).
    refetchInterval: pollWhenVisible(),
    // Freshness declared here, not fought with a global 5-minute window (#496).
    staleTime: STALE_TIME.STANDARD,
    gcTime: GC_TIME.LONG,
    // retry policy is the network-only predicate in app/providers.tsx (#497).
  });
}

/** Registry profile (username, points) for the connected wallet address. */
export function useProfile() {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery<UserProfile | null>({
    queryKey: qk.profile(publicKey),
    queryFn: () =>
      publicKey ? getUserProfile(publicKey) : Promise.resolve(null),
    enabled: !!publicKey,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.STANDARD,
    gcTime: GC_TIME.STANDARD,
  });
}

/** Bot IDs owned by the connected wallet address, from the bot_nft contract. */
export function useBots() {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery<bigint[]>({
    queryKey: qk.bots(publicKey),
    queryFn: () => (publicKey ? getUserBots(publicKey) : Promise.resolve([])),
    enabled: !!publicKey,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.STANDARD,
    gcTime: GC_TIME.STANDARD,
  });
}

/** Accrual state (last claim timestamp, cumulative claimed points) for the connected wallet address. */
export function useAccrualState() {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery<AccrualState | null>({
    queryKey: qk.accrualState(publicKey),
    queryFn: () =>
      publicKey ? getAccrualState(publicKey) : Promise.resolve(null),
    enabled: !!publicKey,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.REALTIME,
    gcTime: GC_TIME.STANDARD,
  });
}

/** AMT token balance for the connected wallet address, from the token contract. */
export function useAmtBalance() {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery<bigint>({
    queryKey: qk.amtBalance(publicKey),
    queryFn: () =>
      publicKey ? getAmtBalance(publicKey) : Promise.resolve(BigInt(0)),
    enabled: !!publicKey,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.REALTIME,
    gcTime: GC_TIME.STANDARD,
  });
}

/** The AMT token's decimals, read once per session from the token contract (#479). */
export function useAmtDecimals() {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery<number>({
    queryKey: qk.amtDecimals(),
    queryFn: () => getAmtDecimals(publicKey ?? undefined),
    enabled: !!publicKey,
    staleTime: STALE_TIME.STATIC,
    gcTime: GC_TIME.LONG,
  });
}

/**
 * Combined accrual rate (pts/hr) of every bot the connected wallet owns, from
 * bot_nft `get_user_total_rate` (#490). Polled like the rest of the dashboard,
 * so buying, selling or minting a bot changes the rate on the next poll.
 */
export function useUserTotalRate() {
  const publicKey = useWalletStore(selectPublicKey);

  return useQuery<bigint>({
    queryKey: qk.userTotalRate(publicKey),
    queryFn: () =>
      publicKey ? getUserTotalRate(publicKey) : Promise.resolve(BigInt(0)),
    enabled: !!publicKey,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.STANDARD,
    gcTime: GC_TIME.STANDARD,
  });
}

export interface DashboardData {
  registered: boolean;
  profile: UserProfile | null;
  bots: bigint[];
  accrualState: AccrualState | null;
  amtBalance: bigint;
}

/**
 * One combined dashboard query (#495).
 *
 * The dashboard previously mounted `useRegistered`, `useProfile`, `useBots`,
 * `useAccrualState`, and `useAmtBalance` — five hooks, five independent RPC
 * requests (each preceded by its own `getAccount`) every poll cycle. This
 * fetches all five in a single `Promise.all` on one cycle. Dashboard screens
 * should prefer this hook; the individual hooks remain for pages that need
 * only one value.
 */
export function useDashboardData() {
  const publicKey = useWalletStore((s) => s.publicKey);

  return useQuery<DashboardData>({
    queryKey: qk.dashboard(publicKey),
    queryFn: async () => {
      if (!publicKey) {
        return {
          registered: false,
          profile: null,
          bots: [],
          accrualState: null,
          amtBalance: BigInt(0),
        };
      }
      const [registered, profile, bots, accrualState, amtBalance] = await Promise.all([
        isRegistered(publicKey),
        getUserProfile(publicKey),
        getUserBots(publicKey),
        getAccrualState(publicKey),
        getAmtBalance(publicKey),
      ]);
      return { registered, profile, bots, accrualState, amtBalance };
    },
    enabled: !!publicKey,
    refetchInterval: pollWhenVisible(),
    staleTime: STALE_TIME.REALTIME,
    gcTime: GC_TIME.STANDARD,
  });
}

/** Claims accrued points (converting to AMT where the threshold is met). */
export function useClaim() {
  const queryClient = useQueryClient();
  const publicKey = useWalletStore(selectPublicKey);

  return useMutation({
    mutationFn: async () => {
      if (!publicKey) throw new Error("Wallet not connected");

      const ACCRUAL_CONTRACT_ID = process.env.NEXT_PUBLIC_ACCRUAL_CONTRACT_ID || "";
      const TOKEN_CONTRACT_ID = process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID || "";
      const REGISTRY_CONTRACT_ID = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID || "";
      const txId = newTxId("claim");

      return new Promise((resolve, reject) => {
        executeTransaction({
          contractId: ACCRUAL_CONTRACT_ID,
          method: "claim",
          args: [
            nativeToScVal(publicKey, { type: "address" }),
            nativeToScVal(TOKEN_CONTRACT_ID, { type: "address" }),
            nativeToScVal(REGISTRY_CONTRACT_ID, { type: "address" }),
          ],
          sourceAddress: publicKey,
          onStatus: (status: TransactionStatus) => {
            trackStatus(txId, "Claim", status);
            switch (status.stage) {
              case "building":
              case "simulating":
              case "assembling":
                toast.loading("Preparing claim transaction...", { id: "claim" });
                break;
              case "signing":
                toast.loading("Waiting for wallet signature...", { id: "claim" });
                break;
              case "submitting":
                toast.loading("Submitting claim to blockchain...", { id: "claim" });
                break;
              case "polling":
                toast.loading(
                  `Confirming on-chain... (${status.hash?.slice(0, 8)})`,
                  { id: "claim" }
                );
                break;
              case "success":
                toast.success("Points claimed successfully!", {
                  id: "claim",
                  action: status.explorerUrl
                    ? {
                        label: "View",
                        onClick: () => window.open(status.explorerUrl, "_blank"),
                      }
                    : undefined,
                });
                resolve(status);
                break;
              case "error":
                toast.error(`Claim failed: ${status.error || "Unknown error"}`, {
                  id: "claim",
                });
                reject(new Error(status.error || "Claim failed"));
                break;
            }
          },
        }).catch(reject);
      });
    },
    onMutate: async () => {
      // Optimistic update (#462): zero the pending counter immediately by
      // moving last_claim_ts to now. Snapshot for rollback in onError.
      await queryClient.cancelQueries({ queryKey: qk.accrualState(publicKey) });
      await queryClient.cancelQueries({ queryKey: qk.dashboard(publicKey) });
      const previousAccrual = queryClient.getQueryData(qk.accrualState(publicKey));
      const previousDashboard = queryClient.getQueryData(qk.dashboard(publicKey));
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      queryClient.setQueryData(
        qk.accrualState(publicKey),
        (old: AccrualState | null | undefined) =>
          old ? { ...old, last_claim_ts: nowSec, total_claimed_points: 0n } : old
      );
      queryClient.setQueryData(
        qk.dashboard(publicKey),
        (old: DashboardData | undefined) =>
          old
            ? {
                ...old,
                accrualState: old.accrualState
                  ? { ...old.accrualState, last_claim_ts: nowSec, total_claimed_points: 0n }
                  : old.accrualState,
              }
            : old
      );
      return { previousAccrual, previousDashboard };
    },
    onError: (
      error: Error,
      _variables: void,
      context: { previousAccrual: unknown; previousDashboard: unknown } | undefined
    ) => {
      // Roll back to the true state on failure (#462).
      if (context) {
        queryClient.setQueryData(qk.accrualState(publicKey), context.previousAccrual);
        queryClient.setQueryData(qk.dashboard(publicKey), context.previousDashboard);
      }
      // onStatus callback already handles error toasts
      console.error("Claim failed:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.profile(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.accrualState(publicKey) });
      queryClient.invalidateQueries({ queryKey: qk.amtBalance(publicKey) });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      queryClient.invalidateQueries({ queryKey: qk.dashboard(publicKey) });
    },
  });
}

/**
 * Computes the offset (in ms) between the client clock and the Stellar
 * ledger close time (#492).
 *
 * A positive offset means the client clock is **ahead** of the ledger. The
 * offset is refreshed on every dashboard poll cycle and surfaced to
 * `useAnimatedPoints` so the interpolated counter stays accurate regardless
 * of browser clock skew.
 */
export function useLedgerTimeOffset(): number {
  const [offsetMs, setOffsetMs] = useState(0);
  const offsetRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const closeTimeSec = await getLedgerCloseTime();
        const closeTimeMs = closeTimeSec * 1000;
        const now = Date.now();
        const skewMs = closeTimeMs - now;

        if (!cancelled) {
          offsetRef.current = skewMs;
          setOffsetMs(skewMs);

          if (Math.abs(skewMs) > 60_000) {
            console.warn(
              `[AutoMint] Client clock skew detected: ${skewMs > 0 ? "+" : ""}${Math.round(skewMs / 1000)}s from ledger time.`,
            );
          }
        }
      } catch {
        // RPC failure — keep the existing offset.
      }
    };

    refresh();
    const interval = setInterval(refresh, DASHBOARD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return offsetMs;
}

export interface AnimatedPoints {
  /**
   * The headline lifetime total: the registry's point total plus the points
   * interpolated since the last claim. Monotonic across a claim — a claim
   * raises the registry total and resets the interpolation to ~0, so the sum
   * never drops (#491).
   */
  total: bigint;
  /** Points accrued since the last claim, recomputed each animation tick. */
  pending: bigint;
  /**
   * The sub-threshold carry toward the next AMT (0 .. POINTS_PER_AMT - 1),
   * taken straight from the accrual state. Shown separately as "progress to
   * next AMT" — it is NOT part of the headline, which is why folding it in
   * made the headline reset after every claim (#491, AM-084).
   */
  progressToNext: bigint;
}

export function useAnimatedPoints(): AnimatedPoints {
  const [pending, setPending] = useState<bigint>(BigInt(0));

  const { data: accrualState } = useAccrualState();
  const { data: profile } = useProfile();
  // The user's real on-chain rate across all their bots (#490), not a default.
  // When the accrual state carries its own `rate` (AM-101) read it from there
  // instead, so the interpolation matches the contract's own view exactly.
  const { data: ratePerHour } = useUserTotalRate();
  const offsetMs = useLedgerTimeOffset();
  const offsetRef = useRef(offsetMs);
  offsetRef.current = offsetMs;

  useEffect(() => {
    const tick = () => {
      if (!accrualState || ratePerHour === undefined) {
        setPending(BigInt(0));
        return;
      }
      // Apply the ledger-clock offset so a fast/slow browser clock does not
      // corrupt the interpolated counter (#492).
      const now = Math.floor((Date.now() + offsetRef.current) / 1000);
      const elapsedSeconds = now - Number(accrualState.last_claim_ts);
      if (elapsedSeconds <= 0) {
        setPending(BigInt(0));
        return;
      }
      setPending(
        (BigInt(elapsedSeconds) * ratePerHour) / BigInt(POINTS_PER_HOUR_DIVISOR),
      );
    };

    tick();
    const interval = setInterval(tick, UPDATE_INTERVAL);
    return () => clearInterval(interval);
  }, [accrualState, ratePerHour]);

  // The lifetime base is the registry point total (profile.points), NOT
  // accrualState.total_claimed_points — that field is only the sub-threshold
  // carry and shrinks back toward zero on every claim (#491, AM-084). When the
  // accrual-state field `lifetime_points` lands (AM-101) it can replace this.
  const lifetime = profile?.points ?? BigInt(0);
  const progressToNext = accrualState?.total_claimed_points ?? BigInt(0);

  return { total: lifetime + pending, pending, progressToNext };
}
