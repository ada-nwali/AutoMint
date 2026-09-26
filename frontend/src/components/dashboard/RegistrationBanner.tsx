"use client";

import { useState, useMemo, useId } from "react";
import { motion } from "framer-motion";
import { Sparkles, User } from "lucide-react";
import clsx from "clsx";
import { useRegister, REGISTER_STEPS } from "@/hooks/useAccrual";
import { useWalletStore, selectNetworkMismatch } from "@/store/walletStore";

interface RegistrationBannerProps {
  onRegisterSuccess?: () => void;
}

export default function RegistrationBanner({ onRegisterSuccess }: RegistrationBannerProps) {
  const [username, setUsername] = useState("");
  const [touched, setTouched] = useState(false);
  const register = useRegister();
  // Registering is a mutation: keep the CTA disabled while Freighter is on
  // the wrong network (#455); executeTransaction is the runtime backstop.
  const networkMismatch = useWalletStore(selectNetworkMismatch);
  const formId = useId();

  const usernameInputId = `${formId}-username`;
  const usernameHelpId = `${formId}-username-help`;
  const usernameErrorId = `${formId}-username-error`;
  const submitReasonId = `${formId}-submit-reason`;
  const networkReasonId = `${formId}-network-reason`;

  // Username validation per AM-205 accessibility requirements
  const validationError = useMemo(() => {
    const trimmed = username.trim();
    if (!trimmed) {
      return "Username is required.";
    }
    if (trimmed.length > 32) {
      return "Username must be 32 characters or fewer.";
    }
    return null;
  }, [username]);

  const isValid = !validationError;
  const submitDisabled = register.isPending || !isValid || networkMismatch;
  const progress = register.progress;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    if (networkMismatch) return;

    if (isValid && username.trim()) {
      register.mutate(username.trim(), {
        onSuccess: () => {
          onRegisterSuccess?.();
        },
      });
    }
  };

  const describedBy = [
    usernameHelpId,
    touched && validationError ? usernameErrorId : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/5 to-card p-6"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/20">
            <Sparkles className="h-5 w-5 text-gold" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-semibold text-text">
              Welcome to AutoMint!
            </h3>
            <p className="mt-1 text-sm text-muted">
              Register to start minting AI bot NFTs and earning points on the Stellar network.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={usernameInputId}
              id={`${formId}-label`}
              className="text-xs font-semibold text-text"
            >
              Username <span className="text-gold" aria-hidden="true">*</span>
            </label>

            <div className="relative">
              <User
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                id={usernameInputId}
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (!touched) setTouched(true);
                }}
                onBlur={() => setTouched(true)}
                placeholder="Enter your username"
                disabled={register.isPending}
                maxLength={32}
                aria-labelledby={`${formId}-label`}
                aria-describedby={describedBy}
                aria-invalid={touched && Boolean(validationError)}
                aria-required="true"
                className={clsx(
                  "w-full rounded-xl border bg-card-2 px-10 py-2.5",
                  "text-sm text-text placeholder:text-muted/50 transition-colors",
                  "focus:outline-none focus:ring-2",
                  touched && validationError
                    ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/30"
                    : "border-liner focus:border-gold/50 focus:ring-gold/30",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
                required
              />
            </div>

            <p id={usernameHelpId} className="text-xs text-muted">
              Choose a public display name on the network (1–32 characters).
            </p>

            {touched && validationError && (
              <p
                id={usernameErrorId}
                role="alert"
                className="text-xs font-medium text-red-400"
              >
                {validationError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {register.isPending && progress && (
              <ol
                aria-label="Registration progress"
                className="flex flex-col gap-1.5 rounded-xl border border-liner bg-card-2 p-3"
              >
                {REGISTER_STEPS.map((step, i) => {
                  const done =
                    progress.step === "done" || i < progress.stepIndex;
                  const current = progress.step === step.id;
                  return (
                    <li
                      key={step.id}
                      aria-current={current ? "step" : undefined}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span aria-hidden="true" className="w-4 text-center">
                        {done ? "✓" : current ? "…" : "○"}
                      </span>
                      <span
                        className={clsx(
                          current && "font-medium text-gold",
                          done && "text-muted",
                          !done && !current && "text-muted/60"
                        )}
                      >
                        {step.label}
                      </span>
                        <span className="sr-only">
                          {done
                            ? "(done)"
                            : current
                              ? "(in progress)"
                              : "(pending)"}
                        </span>
                    </li>
                  );
                })}
              </ol>
            )}

            <button
              type="submit"
              disabled={submitDisabled}
              aria-busy={register.isPending}
              aria-describedby={
                [!isValid ? submitReasonId : null, networkMismatch ? networkReasonId : null]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              className={clsx(
                "flex min-h-11 items-center justify-center gap-2 rounded-xl",
                "border border-gold/30 bg-gold/10 px-4 py-2.5",
                "text-sm font-semibold text-gold",
                "transition-all",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "hover:bg-gold/20 hover:border-gold/50"
              )}
            >
              {register.isPending ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gold border-t-transparent" />
                  Registering...
                </>
              ) : networkMismatch ? (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Switch Network to Register
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Register &amp; Get Started
                </>
              )}
            </button>

            {!isValid && (
              <p
                id={submitReasonId}
                role="status"
                className="text-center text-xs text-muted"
              >
                Please enter a valid username (1–32 characters) to register.
              </p>
            )}

            {networkMismatch && (
              <p
                id={networkReasonId}
                role="status"
                className="text-center text-xs font-medium text-red-400"
              >
                Freighter is on the wrong network — switch to Testnet to
                register.
              </p>
            )}
          </div>
        </form>
      </div>
    </motion.div>
  );
}
