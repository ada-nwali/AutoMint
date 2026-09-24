"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { useWalletStore, selectPublicKey } from "@/store/walletStore";
import { useProfile, useBots } from "@/hooks/useAccrual";

export default function ProfilePage() {
  const publicKey = useWalletStore(selectPublicKey);
  const {
    data: profile,
    isLoading: profileLoading,
    isError: profileError,
    error: profileErrorObj,
    refetch: refetchProfile,
    isRefetching: isProfileRefetching,
  } = useProfile();

  const {
    data: bots,
    isLoading: botsLoading,
    isError: botsError,
    error: botsErrorObj,
    refetch: refetchBots,
    isRefetching: isBotsRefetching,
  } = useBots();

  if (!publicKey) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Connect Your Wallet</h2>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Please connect your wallet to view your profile
          </p>
        </div>
      </div>
    );
  }

  if (profileError || botsError) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <ErrorState
          error={profileErrorObj || botsErrorObj}
          title="Failed to Load Profile"
          message="Could not retrieve profile information from the Stellar network."
          onRetry={() => {
            refetchProfile();
            refetchBots();
          }}
          isRetrying={isProfileRefetching || isBotsRefetching}
          data-testid="profile-error-state"
        />
      </div>
    );
  }

  if (profileLoading || botsLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Skeleton className="h-10 w-48 mb-8" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Profile Not Found</h2>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Please register to create your profile
          </p>
        </div>
      </div>
    );
  }

  const formatDate = (timestamp?: bigint | number) => {
    if (!timestamp) return "N/A";
    const date = new Date(Number(timestamp) * 1000);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatPoints = (points?: bigint) => {
    return (points ?? BigInt(0)).toLocaleString("en-US");
  };

  const formatAmt = (amt?: bigint) => {
    if (!amt) return "0.00";
    const amtNumber = Number(amt) / 10_000_000;
    return amtNumber.toFixed(2);
  };

  const walletAddr = profile.address || publicKey;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          My Profile
        </h1>
        <p className="mt-1 text-base font-medium text-gold">{profile.username}</p>
        <p className="mt-1 text-gray-600 dark:text-gray-400 font-mono text-sm">{walletAddr}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Member Since Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">Member Since</h2>
          <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
            {formatDate(profile.registeredAt)}
          </p>
        </div>

        {/* Total Points Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Points</h2>
          <p className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">
            {formatPoints(profile.points)}
          </p>
        </div>

        {/* Claimed AMT Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">Claimed AMT</h2>
          <p className="mt-2 text-2xl font-bold text-green-600 dark:text-green-400">
            {formatAmt(profile.claimedAmt)} AMT
          </p>
        </div>

        {/* Bot Count Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Bots</h2>
          <p className="mt-2 text-2xl font-bold text-purple-600 dark:text-purple-400">
            {profile.botCount ?? bots?.length ?? 0}
          </p>
        </div>

        {/* Wallet Address Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">Wallet Address</h2>
          <p className="mt-2 text-lg font-mono text-gray-900 dark:text-white break-all">
            {walletAddr.slice(0, 8)}...{walletAddr.slice(-8)}
          </p>
        </div>
      </div>

      {/* Bot IDs Section */}
      {bots && bots.length > 0 && (
        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">
            My Bots ({bots.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {bots.map((botId) => (
              <span
                key={botId.toString()}
                className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
              >
                Bot #{botId.toString()}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
