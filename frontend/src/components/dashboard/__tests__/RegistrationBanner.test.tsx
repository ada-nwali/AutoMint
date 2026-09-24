import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RegistrationBanner from "../RegistrationBanner";
import { useWalletStore } from "@/store/walletStore";

const mockRegisterMutate = jest.fn();
const mockRegisterState: {
  mutate: typeof mockRegisterMutate;
  isPending: boolean;
  progress: { stepIndex: number; step: string } | null;
} = {
  mutate: mockRegisterMutate,
  isPending: false,
  progress: null,
};
jest.mock("@/hooks/useAccrual", () => ({
  useRegister: () => mockRegisterState,
  REGISTER_STEPS: [
    { id: "register", label: "Registering user" },
    { id: "mint", label: "Minting basic bot" },
    { id: "accrual", label: "Starting accrual" },
  ],
}));

describe("RegistrationBanner Form Accessibility (#528)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegisterState.mutate = mockRegisterMutate;
    mockRegisterState.isPending = false;
    mockRegisterState.progress = null;
    useWalletStore.setState({ networkMismatch: false });
  });

  afterEach(() => {
    useWalletStore.setState({ networkMismatch: false });
    mockRegisterState.isPending = false;
    mockRegisterState.progress = null;
  });

  it("renders with a visible, programmatically associated label", () => {
    render(<RegistrationBanner />);

    const input = screen.getByLabelText(/Username/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("aria-required", "true");
  });

  it("associates input with help text via aria-describedby", () => {
    render(<RegistrationBanner />);

    const input = screen.getByLabelText(/Username/i);
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    const helpText = screen.getByText(/Choose a public display name/i);
    expect(helpText).toBeInTheDocument();
    expect(helpText.id).toBe(describedBy);
  });

  it("shows disabled explanation when submit is disabled", () => {
    render(<RegistrationBanner />);

    const submitBtn = screen.getByRole("button", { name: /Register/i });
    expect(submitBtn).toBeDisabled();
    expect(screen.getByText(/Please enter a valid username/i)).toBeInTheDocument();
  });

  it("submits valid username", async () => {
    const onSuccess = jest.fn();
    render(<RegistrationBanner onRegisterSuccess={onSuccess} />);

    const input = screen.getByLabelText(/Username/i);
    await userEvent.type(input, "alice_stellar");

    const submitBtn = screen.getByRole("button", { name: /Register/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    expect(mockRegisterMutate).toHaveBeenCalledWith(
      "alice_stellar",
      expect.any(Object)
    );
  });

  describe("network mismatch (#455)", () => {
    it("disables submit and explains why", () => {
      useWalletStore.setState({ networkMismatch: true });
      render(<RegistrationBanner />);

      const input = screen.getByLabelText(/Username/i);
      fireEvent.change(input, { target: { value: "alice_stellar" } });

      const submitBtn = screen.getByRole("button", { name: /Register/i });
      expect(submitBtn).toBeDisabled();
      expect(
        screen.getByText(/Freighter is on the wrong network/i)
      ).toBeInTheDocument();
      expect(submitBtn.getAttribute("aria-describedby")).toContain(
        screen.getByText(/Freighter is on the wrong network/i).id
      );
    });

    it("does not fire mutate while the wallet is on the wrong network", async () => {
      useWalletStore.setState({ networkMismatch: true });
      render(<RegistrationBanner />);

      const input = screen.getByLabelText(/Username/i);
      await userEvent.type(input, "alice_stellar");

      const submitBtn = screen.getByRole("button", { name: /Register/i });
      fireEvent.click(submitBtn);
      expect(mockRegisterMutate).not.toHaveBeenCalled();
    });

    it("re-enables once the network matches", () => {
      useWalletStore.setState({ networkMismatch: true });
      const { rerender } = render(<RegistrationBanner />);
      expect(screen.getByRole("button", { name: /Register/i })).toBeDisabled();

      useWalletStore.setState({ networkMismatch: false });
      rerender(<RegistrationBanner />);

      const input = screen.getByLabelText(/Username/i);
      fireEvent.change(input, { target: { value: "alice_stellar" } });
      expect(screen.getByRole("button", { name: /Register/i })).toBeEnabled();
    });
  });

  describe("registration progress (#452)", () => {
    it("renders the three steps with the current one marked", () => {
      mockRegisterState.isPending = true;
      mockRegisterState.progress = { stepIndex: 1, step: "mint" };
      render(<RegistrationBanner />);

      const list = screen.getByRole("list", { name: /Registration progress/i });
      expect(list).toBeInTheDocument();

      const items = screen.getAllByRole("listitem");
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent("Registering user");
      expect(items[1]).toHaveTextContent("Minting basic bot");
      expect(items[2]).toHaveTextContent("Starting accrual");

      expect(items[0]).toHaveTextContent("(done)");
      expect(items[1]).toHaveAttribute("aria-current", "step");
      expect(items[1]).toHaveTextContent("(in progress)");
      expect(items[2]).toHaveTextContent("(pending)");

      expect(screen.getByRole("button", { name: /Registering/i })).toBeDisabled();
    });

    it("marks every step done once the pipeline finishes", () => {
      mockRegisterState.isPending = true;
      mockRegisterState.progress = { stepIndex: 3, step: "done" };
      render(<RegistrationBanner />);

      const items = screen.getAllByRole("listitem");
      for (const item of items) {
        expect(item).toHaveTextContent("(done)");
      }
      expect(items.some((i) => i.hasAttribute("aria-current"))).toBe(false);
    });

    it("shows no progress list before the mutation starts", () => {
      render(<RegistrationBanner />);
      expect(
        screen.queryByRole("list", { name: /Registration progress/i })
      ).not.toBeInTheDocument();
    });
  });
});
