import { describe, expect, it } from "vitest";
import { resolveOverviewCapabilities } from "./useOverviewPage.js";

describe("resolveOverviewCapabilities", () => {
  it.each([
    ["BOTH", true, true],
    ["STORE_ONLY", false, true],
    ["API", false, false],
    ["CHECKOUT_ONLY", true, true],
  ] as const)("maps %s to its authorized dashboard surfaces", (input, showCheckout, showStore) => {
    expect(resolveOverviewCapabilities(input)).toMatchObject({ showCheckout, showStore });
  });

  it("keeps absent plans backward-compatible with the full dashboard", () => {
    expect(resolveOverviewCapabilities(undefined)).toMatchObject({
      plan: "BOTH",
      showCheckout: true,
      showStore: true,
    });
  });
});
