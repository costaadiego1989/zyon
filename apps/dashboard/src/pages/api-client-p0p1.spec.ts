/**
 * Regression tests for new P0/P1 api-client methods and types.
 * Covers: URL routing, tenant-scoping invariant (no client-side merchant_id injection),
 * CursorPage normalisation for getAuditEvents / getInstallations.
 */
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  createDashboardApi,
  normalizeApiBase,
  DashboardHttpError,
  type BillingSubscription,
  type PaymentConnection,
  type AuditEvent,
  type AgentRules,
  type NegotiationPolicy,
  type NegotiationPolicyResponse,
  type NegotiationSession,
  type NegotiationStats,
  type CommerceConnection,
  type Installation,
} from "../api-client.js";

// ── helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FetchMock = Mock<(...args: any[]) => Promise<Response>>;

function makeFetch(responseBody: unknown, status = 200): FetchMock {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () =>
      Promise.resolve(
        typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody),
      ),
  } as Response) as FetchMock;
}

function capturedUrl(fetchMock: FetchMock): string {
  return (fetchMock.mock.calls[0] as [string, ...unknown[]])[0] as string;
}

function capturedInit(fetchMock: FetchMock): RequestInit {
  return (fetchMock.mock.calls[0] as [string, RequestInit])[1] as RequestInit;
}

/** Cast FetchMock to the fetch signature expected by createDashboardApi */
function asF(m: FetchMock): typeof fetch {
  return m as unknown as typeof fetch;
}

const BASE = "http://localhost:3000";

// ── normalizeApiBase ──────────────────────────────────────────────────────────

describe("normalizeApiBase", () => {
  it("strips trailing slashes", () => {
    expect(normalizeApiBase("http://api.example.com///")).toBe("http://api.example.com");
  });
  it("preserves path without trailing slash", () => {
    expect(normalizeApiBase("http://api.example.com/v1")).toBe("http://api.example.com/v1");
  });
});

// ── Billing ──────────────────────────────────────────────────────────────────

describe("createDashboardApi — billing", () => {
  const sub: BillingSubscription = {
    plan: "pro",
    status: "active",
    current_period_end: "2026-12-31T00:00:00Z",
    cancel_at_period_end: false,
    trial_end: null,
  };

  it("getBillingSubscription hits /v1/billing/subscription", async () => {
    const f = makeFetch(sub);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getBillingSubscription();
    expect(capturedUrl(f)).toBe(`${BASE}/v1/billing/subscription`);
    expect(result.plan).toBe("pro");
    expect(result.status).toBe("active");
  });

  it("createBillingCheckoutSession posts to /v1/billing/checkout-session", async () => {
    const f = makeFetch({ url: "https://stripe.com/checkout/xyz" });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.createBillingCheckoutSession({ success_url: "/ok", cancel_url: "/cancel" });
    expect(capturedUrl(f)).toContain("/billing/checkout-session");
    expect(capturedInit(f).method).toBe("POST");
    expect(result.url).toContain("stripe.com");
  });

  it("createBillingPortalSession posts to /v1/billing/portal-session", async () => {
    const f = makeFetch({ url: "https://billing.stripe.com/portal/xyz" });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.createBillingPortalSession({ return_url: "/dashboard" });
    expect(capturedUrl(f)).toContain("/billing/portal-session");
    expect(capturedInit(f).method).toBe("POST");
    expect(result.url).toContain("stripe.com");
  });
});

// ── Payment connections ───────────────────────────────────────────────────────

describe("createDashboardApi — payment connections", () => {
  const stripeConn: PaymentConnection = {
    id: "pconn_stripe",
    provider: "stripe",
    status: "active",
    account_id: "acct_test",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  };

  it("getPaymentConnections hits /v1/payments/connections", async () => {
    const f = makeFetch([stripeConn]);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getPaymentConnections();
    expect(capturedUrl(f)).toContain("/payments/connections");
    expect(result[0]?.provider).toBe("stripe");
  });

  it("createStripeOnboardingLink posts and returns url", async () => {
    const f = makeFetch({ url: "https://connect.stripe.com/onboard/xyz" });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.createStripeOnboardingLink({ return_url: "/dashboard", refresh_url: "/dashboard" });
    expect(capturedUrl(f)).toContain("/payments/connections/stripe/onboarding-link");
    expect(capturedInit(f).method).toBe("POST");
    expect(result.url).toContain("stripe.com");
  });

  it("syncStripeConnection posts to /stripe/sync", async () => {
    const f = makeFetch(stripeConn);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.syncStripeConnection();
    expect(capturedUrl(f)).toContain("/payments/connections/stripe/sync");
    expect(result.id).toBe("pconn_stripe");
  });

  it("createAsaasOnboardingLink posts and returns url", async () => {
    const f = makeFetch({ url: "https://asaas.com/onboard/xyz" });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.createAsaasOnboardingLink({ return_url: "/dashboard" });
    expect(capturedUrl(f)).toContain("/payments/connections/asaas/onboarding-link");
    expect(result.url).toContain("asaas.com");
  });
});

// ── Audit events ──────────────────────────────────────────────────────────────

describe("createDashboardApi — audit events", () => {
  const event: AuditEvent = {
    id: "evt_1",
    actor_type: "human",
    actor_id: "usr_admin",
    action: "merchant.rules.updated",
    resource_type: "merchant_rules",
    resource_id: "mrc_test",
    correlation_id: null,
    metadata: null,
    occurred_at: "2026-06-01T10:00:00Z",
  };

  it("getAuditEvents returns CursorPage with limit param", async () => {
    const f = makeFetch({ data: [event], next_cursor: "cursor_abc", has_more: true });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getAuditEvents({ limit: 50 });
    expect(capturedUrl(f)).toContain("/audit-events?limit=50");
    expect(result.data[0]?.action).toBe("merchant.rules.updated");
    expect(result.next_cursor).toBe("cursor_abc");
    expect(result.has_more).toBe(true);
    // HARD INVARIANT: merchant_id must NOT be injected on client side
    expect(capturedUrl(f)).not.toContain("merchant_id");
  });

  it("getAuditEvents passes cursor param for pagination", async () => {
    const f = makeFetch({ data: [event], next_cursor: null, has_more: false });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getAuditEvents({ limit: 50, cursor: "cursor_abc" });
    expect(capturedUrl(f)).toContain("cursor=cursor_abc");
    expect(capturedUrl(f)).toContain("limit=50");
    expect(result.data[0]?.id).toBe("evt_1");
    expect(result.has_more).toBe(false);
  });

  it("getAuditEvents without options calls /audit-events with no query", async () => {
    const f = makeFetch({ data: [], next_cursor: null, has_more: false });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getAuditEvents();
    expect(capturedUrl(f)).toBe(`${BASE}/v1/audit-events`);
    expect(result.data).toEqual([]);
  });

  it("getAuditEvents throws DashboardHttpError on 403", async () => {
    const f = makeFetch("Forbidden", 403);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await expect(api.getAuditEvents()).rejects.toBeInstanceOf(DashboardHttpError);
  });
});

// ── Agent rules ───────────────────────────────────────────────────────────────

describe("createDashboardApi — agent rules", () => {
  const rules: AgentRules = { enabled: true, max_retries: 3 };

  it("getAgentRules hits GET /v1/agent-rules", async () => {
    const f = makeFetch(rules);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getAgentRules();
    expect(capturedUrl(f)).toContain("/agent-rules");
    expect(capturedInit(f).method).toBe("GET");
    expect(result.enabled).toBe(true);
  });

  it("putAgentRules sends PUT with body", async () => {
    const f = makeFetch(rules);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.putAgentRules(rules);
    expect(capturedInit(f).method).toBe("PUT");
    expect(capturedInit(f).body).toContain("enabled");
    // must not inject merchant_id in body
    expect(capturedInit(f).body as string).not.toContain("merchant_id");
  });
});

// ── Negotiation policy ────────────────────────────────────────────────────────

describe("createDashboardApi — negotiation policy", () => {
  const policy: NegotiationPolicy = {
    enabled: true,
    global: { minOfferDiscountPercent: 3, maxDiscountPercent: 15 },
    maxRounds: 2,
    estimatedCostPerAiCallCents: 1,
  };

  const policyResponse = { has_custom_policy: true, policy };

  it("getNegotiationPolicy hits GET /v1/merchant-negotiation-policy", async () => {
    const f = makeFetch(policyResponse);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getNegotiationPolicy();
    expect(capturedUrl(f)).toContain("/merchant-negotiation-policy");
    expect(capturedInit(f).method).toBe("GET");
    expect(result.has_custom_policy).toBe(true);
    expect(result.policy.global.maxDiscountPercent).toBe(15);
  });

  it("putNegotiationPolicy sends PUT", async () => {
    const f = makeFetch(policyResponse);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.putNegotiationPolicy(policy);
    expect(capturedInit(f).method).toBe("PUT");
  });

  it("NegotiationPolicy has correct shape with required fields", () => {
    const p: NegotiationPolicy = {
      enabled: false,
      global: { minOfferDiscountPercent: 0, maxDiscountPercent: 10 },
      maxRounds: 1,
      estimatedCostPerAiCallCents: 2,
    };
    expect(p.global).toBeDefined();
    expect(p.enabled).toBe(false);
    expect(p.maxRounds).toBe(1);
    expect(p.estimatedCostPerAiCallCents).toBe(2);
  });

  it("getNegotiationSessions hits GET /v1/negotiations/sessions", async () => {
    const f = makeFetch({ data: [], next_cursor: null, has_more: false });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getNegotiationSessions({ limit: 10 });
    expect(capturedUrl(f)).toContain("/negotiations/sessions");
    expect(capturedUrl(f)).toContain("limit=10");
    expect(result.data).toEqual([]);
  });

  it("getNegotiationStats hits GET /v1/negotiations/stats with period", async () => {
    const stats = {
      total_sessions: 50,
      total_ai_cost_cents: 200,
      agreement_count: 35,
      agreement_rate: 0.7,
      avg_discount_percent: 8.5,
      total_ledger_entries: 100,
      period: "30d",
    };
    const f = makeFetch(stats);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getNegotiationStats("30d");
    expect(capturedUrl(f)).toContain("/negotiations/stats?period=30d");
    expect(result.total_sessions).toBe(50);
    expect(result.agreement_rate).toBe(0.7);
  });
});

// ── Commerce connections ──────────────────────────────────────────────────────

describe("createDashboardApi — commerce connections", () => {
  const conn: CommerceConnection = {
    provider: "shopify",
    store_url: "https://minhaloja.myshopify.com",
    status: "healthy",
    api_version: "2026-04",
    last_tested_at: null,
    last_synced_at: null,
    last_error_code: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it("getCommerceConnections hits GET /v1/commerce/connections and unwraps cursor page", async () => {
    const f = makeFetch({ data: [conn], next_cursor: null, has_more: false });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getCommerceConnections();
    expect(capturedUrl(f)).toContain("/commerce/connections");
    expect(result[0]?.provider).toBe("shopify");
  });

  it("getCommerceConnections also accepts a bare array", async () => {
    const f = makeFetch([conn]);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getCommerceConnections();
    expect(result[0]?.provider).toBe("shopify");
  });

  it("createCommerceConnection posts with payload", async () => {
    const f = makeFetch(conn);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.createCommerceConnection({
      provider: "shopify",
      shop_domain: "minhaloja.myshopify.com",
      admin_access_token: "shpat_test_token",
    });
    expect(capturedInit(f).method).toBe("POST");
    expect(capturedInit(f).body as string).toContain("shopify");
    // no merchant_id in body — tenant scope via cookie
    expect(capturedInit(f).body as string).not.toContain("merchant_id");
  });

  it("deleteCommerceConnection uses DELETE on the singleton route", async () => {
    const f = makeFetch({ disconnected: true });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.deleteCommerceConnection();
    expect(capturedUrl(f)).toContain("/commerce/connections");
    expect(capturedInit(f).method).toBe("DELETE");
  });

  it("testCommerceConnection posts to /test sub-route", async () => {
    const f = makeFetch({ connection: conn, store_name: "Minha Loja", currency: "BRL" });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.testCommerceConnection();
    expect(capturedUrl(f)).toContain("/commerce/connections/test");
    expect(result.store_name).toBe("Minha Loja");
  });
});

// ── Installations ─────────────────────────────────────────────────────────────

describe("createDashboardApi — installations", () => {
  const inst: Installation = {
    id: "ins_1",
    name: "Producao",
    platform: "shopify",
    status: "active",
    health: "healthy",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it("getInstallations normalises array response", async () => {
    const f = makeFetch([inst]);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getInstallations();
    expect(capturedUrl(f)).toContain("/installations");
    expect(result[0]?.id).toBe("ins_1");
    expect(capturedUrl(f)).not.toContain("merchant_id");
  });

  it("getInstallations normalises CursorPage response", async () => {
    const f = makeFetch({ data: [inst], next_cursor: null, has_more: false });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getInstallations();
    expect(result[0]?.health).toBe("healthy");
  });

  it("checkInstallationHealth hits /installations/:id/health", async () => {
    const f = makeFetch({ status: "healthy", checks: {} });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.checkInstallationHealth("ins_1");
    expect(capturedUrl(f)).toContain("/installations/ins_1/health");
    expect(result.status).toBe("healthy");
  });

  it("getInstallation hits /installations/:id", async () => {
    const f = makeFetch(inst);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getInstallation("ins_1");
    expect(capturedUrl(f)).toContain("/installations/ins_1");
    expect(result.name).toBe("Producao");
  });
});

// ── Customers (cursor pagination) ───────────────────────────────────────────

describe("createDashboardApi — getCustomersPage", () => {
  const page = {
    data: [
      {
        id: "global_user_abc",
        profile: { full_name: "Maria", email: "m@t.com", phone: "+55" },
        first_seen_at: "2026-06-01T00:00:00Z",
        last_seen_at: "2026-06-28T00:00:00Z",
      },
    ],
    next_cursor: "abc",
    has_more: true,
  };

  it("getCustomersPage returns full CursorPage object", async () => {
    const f = makeFetch(page);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getCustomersPage(30);
    expect(result.data).toHaveLength(1);
    expect(result.next_cursor).toBe("abc");
    expect(result.has_more).toBe(true);
    expect(capturedUrl(f)).toContain("/customers?limit=30");
  });

  it("getCustomersPage with cursor includes both params", async () => {
    const f = makeFetch({ data: [], next_cursor: null, has_more: false });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.getCustomersPage(30, "abc");
    expect(capturedUrl(f)).toContain("limit=30");
    expect(capturedUrl(f)).toContain("cursor=abc");
  });

  it("getCustomersPage without params calls /customers with no query", async () => {
    const f = makeFetch({ data: [], next_cursor: null, has_more: false });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.getCustomersPage();
    expect(capturedUrl(f)).toBe(`${BASE}/v1/customers`);
  });
});

// ── 401 / session expiry contract ─────────────────────────────────────────────

describe("session expiry contract", () => {
  it("throws DashboardHttpError on 401 from new billing endpoint", async () => {
    const f = makeFetch("Unauthorized", 401);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const err = await api.getBillingSubscription().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DashboardHttpError);
    expect((err as DashboardHttpError).status).toBe(401);
  });

  it("throws DashboardHttpError on 401 from audit-events endpoint", async () => {
    const f = makeFetch("Unauthorized", 401);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const err = await api.getAuditEvents().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DashboardHttpError);
    expect((err as DashboardHttpError).status).toBe(401);
  });

  it("throws DashboardHttpError on 401 from payment connections endpoint", async () => {
    const f = makeFetch("Unauthorized", 401);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const err = await api.getPaymentConnections().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DashboardHttpError);
    expect((err as DashboardHttpError).status).toBe(401);
  });
});
