"use client";

import React from "react";
import { AlertTriangle, WifiOff, ShieldAlert, RotateCw, LifeBuoy } from "lucide-react";
import clsx from "clsx";
import { classifyError } from "@/lib/errorMap";

export interface ErrorStateProps {
  error?: unknown;
  title?: string;
  message?: string;
  onRetry?: () => void | Promise<unknown>;
  isRetrying?: boolean;
  supportLink?: string;
  className?: string;
  compact?: boolean;
  "data-testid"?: string;
}

export function ErrorState({
  error,
  title,
  message,
  onRetry,
  isRetrying = false,
  supportLink = "https://github.com/Ada-Girly881/AutoMint/issues",
  className,
  compact = false,
  "data-testid": testId = "error-state",
}: ErrorStateProps) {
  const classified = error ? classifyError(error) : null;

  const displayTitle = title || classified?.title || "Unable to Load Data";
  const displayMessage =
    message ||
    classified?.message ||
    "An unexpected error occurred while loading data. Please try again.";

  const renderIcon = () => {
    if (classified?.category === "network") {
      return <WifiOff className="h-6 w-6 text-pink" aria-hidden="true" />;
    }
    if (classified?.category === "contract") {
      return <ShieldAlert className="h-6 w-6 text-gold" aria-hidden="true" />;
    }
    return <AlertTriangle className="h-6 w-6 text-gold" aria-hidden="true" />;
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid={testId}
      className={clsx(
        "flex flex-col items-center justify-center rounded-2xl border border-liner bg-card text-center",
        compact ? "p-6" : "min-h-[220px] p-8 sm:p-10",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card-2 border border-liner mb-3">
        {renderIcon()}
      </div>

      <h3 className="font-display text-base sm:text-lg font-semibold text-text">
        {displayTitle}
      </h3>

      <p className="mt-1.5 max-w-md text-xs sm:text-sm text-muted">
        {displayMessage}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            aria-busy={isRetrying}
            className={clsx(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition-all",
              "border border-gold/30 bg-gold/10 text-gold hover:bg-gold/20 hover:border-gold/50",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            <RotateCw
              className={clsx("h-3.5 w-3.5", isRetrying && "animate-spin")}
              aria-hidden="true"
            />
            {isRetrying ? "Retrying…" : "Try Again"}
          </button>
        )}

        {supportLink && (
          <a
            href={supportLink}
            target="_blank"
            rel="noopener noreferrer"
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-xl border border-liner bg-card-2 px-3.5 py-2 text-xs sm:text-sm font-medium text-muted transition-colors",
              "hover:border-liner-hover hover:text-text",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            )}
          >
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />
            Get Support
          </a>
        )}
      </div>
    </div>
  );
}

export default ErrorState;
