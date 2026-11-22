import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Footer from "../components/layout/Footer";

describe("Footer Component", () => {
  it("renders the brand name and tagline", () => {
    render(<Footer />);

    expect(screen.getByText("AutoMint")).toBeInTheDocument();
    expect(
      screen.getByText("Mint, earn, and trade AI bot NFTs on Stellar.")
    ).toBeInTheDocument();
  });

  it("renders each link group with its heading", () => {
    render(<Footer />);

    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText("Resources")).toBeInTheDocument();
    expect(screen.getByText("Community")).toBeInTheDocument();
  });

  it("renders internal product links with the correct hrefs and no external attributes", () => {
    render(<Footer />);

    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink).toHaveAttribute("href", "/dashboard");
    expect(dashboardLink).not.toHaveAttribute("target");
    expect(dashboardLink).not.toHaveAttribute("rel");

    expect(screen.getByRole("link", { name: "Marketplace" })).toHaveAttribute(
      "href",
      "/marketplace"
    );
    expect(screen.getByRole("link", { name: "Leaderboard" })).toHaveAttribute(
      "href",
      "/leaderboard"
    );
  });

  it("renders external resource/community links that open in a new tab safely", () => {
    render(<Footer />);

    const repoUrl = "https://github.com/Ada-Girly881/AutoMint";

    const projectDocs = screen.getByRole("link", { name: /Project Docs/i });
    expect(projectDocs).toHaveAttribute(
      "href",
      `${repoUrl}/tree/testnet-implementation/docs`
    );
    expect(projectDocs).toHaveAttribute("target", "_blank");
    expect(projectDocs).toHaveAttribute("rel", "noopener noreferrer");

    const deploymentGuide = screen.getByRole("link", { name: /Deployment Guide/i });
    expect(deploymentGuide).toHaveAttribute(
      "href",
      `${repoUrl}/blob/testnet-implementation/docs/DEPLOYMENT.md`
    );
    expect(deploymentGuide).toHaveAttribute("target", "_blank");

    const githubLink = screen.getByRole("link", { name: /GitHub/i });
    expect(githubLink).toHaveAttribute("href", repoUrl);
    expect(githubLink).toHaveAttribute("target", "_blank");

    const licenseLink = screen.getByRole("link", { name: /License/i });
    expect(licenseLink).toHaveAttribute(
      "href",
      `${repoUrl}/blob/testnet-implementation/LICENSE`
    );
    expect(licenseLink).toHaveAttribute("target", "_blank");
  });

  it("renders the network indicator for the configured network", () => {
    render(<Footer />);

    expect(screen.getByText(/Network: (TESTNET|MAINNET)/i)).toBeInTheDocument();
  });

  it("renders the current year in the copyright notice", () => {
    render(<Footer />);

    const year = new Date().getFullYear();
    expect(
      screen.getByText(new RegExp(`\\u00a9 ${year} AutoMint`))
    ).toBeInTheDocument();
  });

  it("renders the 'Built on' credits linking to Stellar and Soroban", () => {
    render(<Footer />);

    expect(
      screen.getByRole("link", { name: "Stellar (opens in new tab)" })
    ).toHaveAttribute("href", "https://stellar.org");
    expect(
      screen.getByRole("link", { name: "Soroban (opens in new tab)" })
    ).toHaveAttribute("href", "https://soroban.stellar.org");
  });

  it("does not throw when a link is clicked (no custom click handlers wired up)", async () => {
    const user = userEvent.setup();
    render(<Footer />);

    await user.click(screen.getByRole("link", { name: "Dashboard" }));

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });
});
