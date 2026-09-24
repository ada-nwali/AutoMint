"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusLock(
  containerRef: React.RefObject<HTMLElement>,
  onEscape?: () => void
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Set scroll lock
    document.body.style.overflow = "hidden";

    // Plain closures — React hooks (useCallback) must never be called
    // inside an effect body, which is a conditional block (#452-era crash:
    // opening a Modal or the mobile menu threw "Invalid hook call").
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscape) {
        onEscape();
      }
    };

    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !containerRef.current) return;
      const focusable = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      handleEscape(e);
      trapFocus(e);
    };

    document.addEventListener("keydown", handleKey);

    previousFocusRef.current = document.activeElement as HTMLElement;

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
      previousFocusRef.current?.focus();
    };
  }, [containerRef, onEscape]);

  return undefined;
}
