"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps focus inside `containerRef` while `isOpen` is true: Escape calls
 * `onEscape`, Tab / Shift+Tab cycle within the container, and body scroll is
 * locked.
 *
 * The effect is keyed on `isOpen` (#1371), so it engages every time the
 * dialog opens rather than depending on the parent passing a new inline
 * callback. `onEscape` is read through a ref, so its identity never re-runs
 * the effect. On open, focus moves to the first focusable element; on close,
 * focus returns to the previously focused element and the previous
 * `body.style.overflow` value is restored.
 */
export function useFocusLock(
  containerRef: React.RefObject<HTMLElement>,
  isOpen: boolean,
  onEscape?: () => void
) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;

    // Set scroll lock
    document.body.style.overflow = "hidden";

    // Move focus into the dialog; fall back to the container itself.
    const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE);
    if (firstFocusable) {
      firstFocusable.focus();
    } else {
      if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
      container.focus();
    }

    // Plain closures — React hooks (useCallback) must never be called
    // inside an effect body, which is a conditional block (#452-era crash:
    // opening a Modal or the mobile menu threw "Invalid hook call").
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscapeRef.current?.();
      }
    };

    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !containerRef.current) return;
      const focusable = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof Node && containerRef.current.contains(active);

      if (e.shiftKey) {
        if (active === first || !inside) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !inside) {
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

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [containerRef, isOpen]);

  return undefined;
}
