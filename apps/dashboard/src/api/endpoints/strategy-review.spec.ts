import { describe, expect, it, vi } from "vitest";
import { revenueManagerEndpoints } from "./revenue-manager.js";

describe("versioned strategy review transport", () => {
  it("collects the exact strategy version without accepting counts or client budget authority", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await revenueManagerEndpoints("https://api.test", fetchImpl).collectStrategyMetrics("a/b", 2);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.test/v1/revenue-manager/strategies/a%2Fb/metrics");
    const options = fetchImpl.mock.calls[0][1];
    expect(options).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(String(options?.body))).toEqual({ version: 2 });
  });
  it("reads with credentials and an encoded ID without writing a decision", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "a/b" })));
    expect(await revenueManagerEndpoints("https://api.test", fetchImpl).getStrategyReview("a/b")).toEqual({ id: "a/b" });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.test/v1/revenue-manager/strategies/a%2Fb");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET", credentials: "include" });
  });
  it.each(["revision", "reject"] as const)("binds %s to exact version, hash and stable retry identity; strips authority fields", async kind => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 202 }));
    const api = revenueManagerEndpoints("https://api.test", fetchImpl);
    const input = { version: 2, proposal_hash: "a".repeat(64), request_key: "same-review-key", feedback: "Minha preferência", merchantId: "forged", actorId: "forged" };
    await api.decideStrategy("id", kind, input);
    fetchImpl.mockResolvedValue(new Response("{}", { status: 200 }));
    await api.decideStrategy("id", kind, input);
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.test/v1/revenue-manager/strategies/id/${kind === "revision" ? "revisions" : "reject"}`);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(input.request_key);
      expect(JSON.parse(String(init?.body))).toEqual({ version: 2, proposal_hash: input.proposal_hash, request_key: input.request_key, feedback: input.feedback });
    }
  });
  it("preserves a version conflict without automatic resubmission", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"message":"STRATEGY_VERSION_CONFLICT"}', { status: 409 }));
    await expect(revenueManagerEndpoints("https://api.test", fetchImpl).decideStrategy("id", "reject",
      { version: 1, proposal_hash: "a".repeat(64), request_key: "same-review-key" })).rejects.toMatchObject({ status: 409 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
