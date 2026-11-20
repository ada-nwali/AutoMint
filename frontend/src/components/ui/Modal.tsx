"use client";

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import clsx from "clsx";
import { useFocusLock } from "@/hooks/useFocusLock";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export default function Modal({ isOpen, onClose, title, description, children }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // useId() gives each mounted instance a unique id, preventing collisions
  // when two modals are open simultaneously (#1370).
  const uid = useId();
  const titleId = title ? `${uid}-title` : undefined;
  const descId = description ? `${uid}-description` : undefined;

  useFocusLock(contentRef, isOpen, onClose);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={overlayRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleOverlayClick}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
          <motion.div
            ref={contentRef}
            role="dialog"
            aria-modal="true"
            aria-label={title ? undefined : "Dialog"}
            aria-labelledby={titleId}
            aria-describedby={descId}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.2 }}
            className={clsx(
              "relative w-full max-w-lg rounded-2xl border border-liner bg-card p-6 shadow-2xl",
              "max-h-[85vh] overflow-y-auto",
              "mx-auto my-auto",
            )}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="min-w-0 flex-1">
                {title && (
                  <h2 id={titleId} className="font-display text-lg font-bold text-text">
                    {title}
                  </h2>
                )}
                {description && (
                  <p id={descId} className="mt-1 text-sm text-muted">
                    {description}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="shrink-0 rounded-lg p-1.5 text-muted hover:text-text hover:bg-card-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
