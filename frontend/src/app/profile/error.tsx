"use client";

/**
 * Profile route-segment error boundary.
 *
 * The profile decodes the user record, bot ids and transaction history. A
 * throw in any of them is contained to this route instead of falling through
 * to the root boundary.
 */

import { RouteError } from "@/components/ui/RouteError";

export default function ProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      boundary="profile"
      title="Profile failed to load"
      description="Your profile could not be rendered. Your bots and claimed AMT are unaffected."
    />
  );
}
