/**
 * Unit tests for BillingPage — billing-page.tsx
 * Validates billing API payloads and error handling. Invoice UI is exercised in billing-history.spec.tsx.
 * Environment: node (no jsdom) — tests import the module and validate constants/API calls.
 */
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  createDashboardApi,
  DashboardHttpError,
  type BillingSubscription,
} from "../api-client.js";

// ── helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FetchMock = Mock<(...args: any[]) => Promise<Response>>;

function makeFetch(responseBody: unknown, status = 200): FetchMock {
  return vi.fn(async () => new Response(typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody), { status, headers: { "Content-Type": "application/json" } })) as FetchMock;
}

function capturedInit(fetchMock: FetchMock): RequestInit {
  return (fetchMock.mock.calls[0] as [string, RequestInit])[1] as RequestInit;
}

function asF(m: FetchMock): typeof fetch {
  return m as unknown as typeof fetch;
}

const BASE = "http://localhost:3000";

// ── price_id passing ─────────────────────────────────────────────────────────

describe("BillingPage price_id", () => {
  it("createBillingCheckoutSession receives price_id in payload", async () => {
    const f = makeFetch({ url: "https://checkout.stripe.com/session123" });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });

    await api.createBillingCheckoutSession({
      price_id: "growth",
      success_url: "http://localhost/success",
      cancel_url: "http://localhost/cancel",
    });

    const init = capturedInit(f);
    const body = JSON.parse(init.body as string);
    expect(body.price_id).toBe("growth");
  });

  it("createBillingCheckoutSession sends price_id for starter plan", async () => {
    const f = makeFetch({ url: "https://checkout.stripe.com/sess_starter" });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });

    await api.createBillingCheckoutSession({
      price_id: "starter",
      success_url: "http://localhost/success",
      cancel_url: "http://localhost/cancel",
    });

    const init = capturedInit(f);
    const body = JSON.parse(init.body as string);
    expect(body.price_id).toBe("starter");
  });

  it("createBillingCheckoutSession sends price_id for scale plan", async () => {
    const f = makeFetch({ url: "https://checkout.stripe.com/sess_scale" });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });

    await api.createBillingCheckoutSession({
      price_id: "scale",
      success_url: "http://localhost/success",
      cancel_url: "http://localhost/cancel",
    });

    const init = capturedInit(f);
    const body = JSON.parse(init.body as string);
    expect(body.price_id).toBe("scale");
  });
});

// ── BillingSubscription type with usage ──────────────────────────────────────

describe("BillingSubscription type", () => {
  it("accepts subscription without usage field", () => {
    const sub: BillingSubscription = {
      plan: "growth",
      status: "active",
      current_period_end: "2026-08-01T00:00:00Z",
      cancel_at_period_end: false,
      trial_end: null,
    };
    expect(sub.usage).toBeUndefined();
  });

  it("accepts subscription with usage field", () => {
    const sub: BillingSubscription = {
      plan: "scale",
      status: "active",
      current_period_end: "2026-08-01T00:00:00Z",
      cancel_at_period_end: false,
      trial_end: null,
      usage: {
        orders_current: 4500,
        orders_limit: null,
        installations_current: 3,
        installations_limit: 5,
      },
    };
    expect(sub.usage?.orders_current).toBe(4500);
    expect(sub.usage?.installations_current).toBe(3);
  });

  it("accepts usage with null values", () => {
    const sub: BillingSubscription = {
      plan: "starter",
      status: "trialing",
      current_period_end: null,
      cancel_at_period_end: false,
      trial_end: "2026-07-15T00:00:00Z",
      usage: {
        orders_current: null,
        orders_limit: null,
        installations_current: null,
        installations_limit: null,
      },
    };
    expect(sub.usage?.orders_current).toBeNull();
  });
});

// ── API error handling ───────────────────────────────────────────────────────

describe("BillingPage API error handling", () => {
  it("getBillingSubscription failure returns proper error", async () => {
    const f = makeFetch("Unauthorized", 401);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });

    await expect(api.getBillingSubscription()).rejects.toThrow(DashboardHttpError);
  });

  it("createBillingCheckoutSession failure returns proper error", async () => {
    const f = makeFetch("Payment Required", 402);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });

    await expect(
      api.createBillingCheckoutSession({ price_id: "growth" }),
    ).rejects.toThrow(DashboardHttpError);
  });

  it("createBillingPortalSession failure returns proper error", async () => {
    const f = makeFetch("Internal Server Error", 500);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });

    await expect(
      api.createBillingPortalSession({ return_url: "http://localhost" }),
    ).rejects.toThrow(DashboardHttpError);
  });
});
