import React from "react";
import { render } from "@testing-library/react";
import { Skeleton, CardSkeleton, BotCardSkeleton } from "../Skeleton";
import "@testing-library/jest-dom";

describe("Skeleton Components", () => {
  describe("Skeleton", () => {
    it("renders with default classes", () => {
      const { container } = render(<Skeleton />);
      expect(container.firstChild).toHaveClass("animate-pulse");
      expect(container.firstChild).toHaveClass("rounded-lg");
      expect(container.firstChild).toHaveClass("bg-card-2");
    });

    it("accepts and merges custom className", () => {
      const { container } = render(<Skeleton className="custom-class h-10" />);
      expect(container.firstChild).toHaveClass("custom-class");
      expect(container.firstChild).toHaveClass("h-10");
      expect(container.firstChild).toHaveClass("animate-pulse");
    });
  });

  describe("CardSkeleton", () => {
    it("renders successfully", () => {
      const { container } = render(<CardSkeleton />);
      expect(container.firstChild).toBeInTheDocument();
      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    });
  });

  describe("BotCardSkeleton", () => {
    it("renders successfully", () => {
      const { container } = render(<BotCardSkeleton />);
      expect(container.firstChild).toBeInTheDocument();
      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    });
  });
});
