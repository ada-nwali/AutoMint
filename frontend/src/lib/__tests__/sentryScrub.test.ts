import { scrubEvent } from "../sentryScrub";

const ADDRESS = "G" + "A".repeat(55);
const MUXED_ADDRESS = "M" + "A".repeat(68);

describe("scrubEvent", () => {
  it("scrubs exception messages, nested breadcrumb data, request data, and muxed addresses", () => {
    const result = scrubEvent({
      message: `failed for ${ADDRESS}`,
      exception: {
        values: [{ value: `wallet ${MUXED_ADDRESS}`, type: "Error" }],
      },
      breadcrumbs: [
        {
          category: "rpc",
          data: { nested: { email: "owner@example.com", address: ADDRESS } },
        },
      ],
      request: {
        url: `/simulate?address=${ADDRESS}`,
        data: { payload: { address: MUXED_ADDRESS } },
        headers: { Referer: "https://example.test/private", "x-request-id": "safe" },
      },
    });

    expect(result.message).toBe("failed for [address]");
    expect(result.exception?.values?.[0]?.value).toBe("wallet [address]");
    expect(result.breadcrumbs?.[0]?.data).toEqual({
      nested: { email: "[email]", address: "[address]" },
    });
    expect(result.request?.data).toEqual({ payload: { address: "[address]" } });
    expect(result.request?.url).toBe("/simulate?address=[address]");
    expect(result.request?.headers).toEqual({ "x-request-id": "safe" });
  });
});
