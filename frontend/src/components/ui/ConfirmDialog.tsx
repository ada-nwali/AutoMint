"use client";

import Modal from "./Modal";
import clsx from "clsx";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  /** Disables the confirm button, e.g. while the confirmed action is in flight. */
  confirmDisabled?: boolean;
  /** Optional extra content rendered between the description and the buttons. */
  children?: React.ReactNode;
}

/**
 * A confirm/cancel prompt built on {@link Modal}, which owns the portal,
 * focus lock, Escape handling and the useId()-based title/description ids
 * (#1370).
 */
function ConfirmDialog({
  isOpen,
  onClose,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  confirmDisabled = false,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} description={description}>
      {children}
      <div className="flex gap-3 mt-6">
        <button
          type="button"
          onClick={onConfirm}
          className={clsx(
            "flex-1 rounded-lg border px-4 py-2 font-semibold transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "bg-gold/10 text-gold border-gold/30 hover:bg-gold/20 hover:border-gold/50",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          disabled={confirmDisabled}
        >
          {confirmText}
        </button>
        <button
          type="button"
          onClick={onClose}
          className={clsx(
            "flex-1 rounded-lg px-4 py-2 font-semibold transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "text-muted hover:text-text hover:bg-card-2",
          )}
        >
          {cancelText}
        </button>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
