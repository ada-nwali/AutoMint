import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ConfirmDialog from "../ConfirmDialog";
import "@testing-library/jest-dom";

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <ConfirmDialog
        isOpen={false}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Delete item"
        description="Are you sure?"
      />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders title, description and default button labels when open", () => {
    render(
      <ConfirmDialog
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Delete item"
        description="Are you sure?"
      />
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Delete item")).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("uses custom confirm and cancel labels", () => {
    render(
      <ConfirmDialog
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        title="Buy"
        description="Buy this bot?"
        confirmText="Buy"
        cancelText="Keep Browsing"
      />
    );
    expect(screen.getByRole("button", { name: "Buy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep Browsing" })).toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = jest.fn();
    render(
      <ConfirmDialog
        isOpen
        onClose={jest.fn()}
        onConfirm={onConfirm}
        title="T"
        description="D"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the cancel button is clicked", () => {
    const onClose = jest.fn();
    render(
      <ConfirmDialog isOpen onClose={onClose} onConfirm={jest.fn()} title="T" description="D" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the header close button is clicked", () => {
    const onClose = jest.fn();
    render(
      <ConfirmDialog isOpen onClose={onClose} onConfirm={jest.fn()} title="T" description="D" />
    );
    fireEvent.click(screen.getByLabelText("Close modal"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = jest.fn();
    render(
      <ConfirmDialog isOpen onClose={onClose} onConfirm={jest.fn()} title="T" description="D" />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when clicking the overlay", () => {
    const onClose = jest.fn();
    const { container } = render(
      <ConfirmDialog isOpen onClose={onClose} onConfirm={jest.fn()} title="T" description="D" />
    );
    void container;
    const dialog = screen.getByRole("dialog");
    const overlay = dialog.parentElement;
    if (overlay) {
      fireEvent.click(overlay);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it("does not call onClose when clicking inside the dialog", () => {
    const onClose = jest.fn();
    render(
      <ConfirmDialog isOpen onClose={onClose} onConfirm={jest.fn()} title="T" description="D" />
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("wraps focus forward with Tab from the last focusable element", () => {
    render(
      <ConfirmDialog isOpen onClose={jest.fn()} onConfirm={jest.fn()} title="T" description="D" />
    );
    const dialog = screen.getByRole("dialog");
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const last = focusable[focusable.length - 1]!;
    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);
  });

  it("wraps focus backward with Shift+Tab from the first focusable element", () => {
    render(
      <ConfirmDialog isOpen onClose={jest.fn()} onConfirm={jest.fn()} title="T" description="D" />
    );
    const dialog = screen.getByRole("dialog");
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    first.focus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("does not intercept Tab when focus is in the middle of the dialog", () => {
    render(
      <ConfirmDialog isOpen onClose={jest.fn()} onConfirm={jest.fn()} title="T" description="D" />
    );
    const dialog = screen.getByRole("dialog");
    const focusable = dialog.querySelectorAll<HTMLElement>("button");
    const middle = focusable[1]!;
    middle.focus();
    expect(document.activeElement).toBe(middle);

    fireEvent.keyDown(document, { key: "Tab" });
    // Middle element — no wrap, active element unchanged by our handler.
    expect(document.activeElement).toBe(middle);
  });
});
