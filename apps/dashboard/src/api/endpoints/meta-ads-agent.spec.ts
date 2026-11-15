import { expect, test, vi } from "vitest";
import { metaAdsAgentEndpoints } from "./meta-ads-agent.js";

test("authenticated module routes preserve approval digest and return uncertain execution without retry", async () => {
  const calls: Array<{url: string; init?: RequestInit}> = [];
  const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({url: String(url), init});
    return new Response(JSON.stringify({ id: "e1", status: "execution_unknown" }));
  });
  const api = metaAdsAgentEndpoints("https://api.example.test", f as typeof fetch);
  await api.approve("p1", "reviewed-digest");
  expect(calls[0].url).toBe("https://api.example.test/v1/meta-ads-agent/proposals/p1/approve");
  expect(calls[0].init?.credentials).toBe("include");
  expect(JSON.parse(calls[0].init!.body as string)).toEqual({ digest: "reviewed-digest" });
  expect((await api.execute("p1")).status).toBe("execution_unknown");
  expect(calls).toHaveLength(2);
  expect(JSON.parse(calls[1].init!.body as string)).toEqual({});
});
test("checkout keeps accepted offer version and explicit request identity; products safely encode query", async () => {
  const f = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("{}"));
  const api = metaAdsAgentEndpoints("https://api.example.test", f as typeof fetch);
  await api.checkout({kind: "extra_images", idempotencyKey: "purchase-one", offerVersion: "v1"});
  expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({kind: "extra_images", idempotencyKey: "purchase-one", offerVersion: "v1"});
  await api.products("sapato & bolsa");
  expect(String(f.mock.calls[1][0])).toBe("https://api.example.test/v1/meta-ads-agent/products?query=sapato+%26+bolsa");
});
test("provider rejection and network failure stay errors and never resend a write", async () => {
  const rejected = vi.fn(async () => new Response('{"code":"proposal_stale"}', { status: 409 }));
  await expect(metaAdsAgentEndpoints("https://api.example.test", rejected as typeof fetch).execute("p1")).rejects.toMatchObject({status: 409, responseBody: '{"code":"proposal_stale"}'});
  expect(rejected).toHaveBeenCalledTimes(1);
  const lost = vi.fn(async () => {throw new Error("offline");});
  await expect(metaAdsAgentEndpoints("https://api.example.test", lost as typeof fetch).execute("p1")).rejects.toMatchObject({status: 0});
  expect(lost).toHaveBeenCalledTimes(1);
});
