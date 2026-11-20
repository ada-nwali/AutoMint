import { formatTimeLeft, isListingExpired } from "../format";

describe("listing expiry (#1405)", () => {
  const now = 1_700_000_000;

  it("treats a listing as expired only after expires_at", () => {
    expect(isListingExpired({ expires_at: BigInt(now) }, now)).toBe(false);
    expect(isListingExpired({ expires_at: BigInt(now - 1) }, now)).toBe(true);
    expect(isListingExpired({ expires_at: 0n }, now)).toBe(false);
    expect(isListingExpired({}, now)).toBe(false);
  });

  it("formats the time left", () => {
    expect(formatTimeLeft(BigInt(now + 2 * 86_400 + 3 * 3_600), now)).toBe("2d 3h");
    expect(formatTimeLeft(BigInt(now + 45 * 60), now)).toBe("45m");
    expect(formatTimeLeft(BigInt(now - 1), now)).toBe("Expired");
  });
});
