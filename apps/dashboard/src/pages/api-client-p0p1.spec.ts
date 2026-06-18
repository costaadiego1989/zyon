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
    merchant_id: "mrc_test",
    actor_id: "usr_admin",
    action: "merchant.rules.updated",
    resource_type: "merchant_rules",
    resource_id: "mrc_test",
    metadata: null,
    created_at: "2026-06-01T10:00:00Z",
  };

  it("getAuditEvents normalises array response", async () => {
    const f = makeFetch([event]);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getAuditEvents(50);
    expect(capturedUrl(f)).toContain("/audit-events?limit=50");
    expect(result[0]?.action).toBe("merchant.rules.updated");
    // HARD INVARIANT: merchant_id must NOT be injected on client side
    // The API is tenant-scoped via cookie; no merchant_id param in URL
    expect(capturedUrl(f)).not.toContain("merchant_id");
  });

  it("getAuditEvents normalises CursorPage response", async () => {
    const f = makeFetch({ data: [event], next_cursor: null, has_more: false });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getAuditEvents();
    expect(result[0]?.id).toBe("evt_1");
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
  const policy: NegotiationPolicy = { enabled: true, max_discount_pct: 15 };

  it("getNegotiationPolicy hits GET /v1/negotiations/policy", async () => {
    const f = makeFetch(policy);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getNegotiationPolicy();
    expect(capturedUrl(f)).toContain("/negotiations/policy");
    expect(capturedInit(f).method).toBe("GET");
    expect(result.max_discount_pct).toBe(15);
  });

  it("putNegotiationPolicy sends PUT", async () => {
    const f = makeFetch(policy);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.putNegotiationPolicy(policy);
    expect(capturedInit(f).method).toBe("PUT");
  });
});

// ── Commerce connections ──────────────────────────────────────────────────────

describe("createDashboardApi — commerce connections", () => {
  const conn: CommerceConnection = {
    id: "cconn_1",
    platform: "shopify",
    shop_domain: "minhaloja.myshopify.com",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it("getCommerceConnections hits GET /v1/commerce/connections", async () => {
    const f = makeFetch([conn]);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.getCommerceConnections();
    expect(capturedUrl(f)).toContain("/commerce/connections");
    expect(result[0]?.platform).toBe("shopify");
  });

  it("createCommerceConnection posts with payload", async () => {
    const f = makeFetch(conn);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.createCommerceConnection({ platform: "shopify", shop_domain: "minhaloja.myshopify.com" });
    expect(capturedInit(f).method).toBe("POST");
    expect(capturedInit(f).body as string).toContain("shopify");
    // no merchant_id in body — tenant scope via cookie
    expect(capturedInit(f).body as string).not.toContain("merchant_id");
  });

  it("deleteCommerceConnection uses DELETE with encoded id", async () => {
    const f = makeFetch({});
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.deleteCommerceConnection("cconn_1");
    expect(capturedUrl(f)).toContain("/commerce/connections/cconn_1");
    expect(capturedInit(f).method).toBe("DELETE");
  });

  it("testCommerceConnection posts to /test sub-route", async () => {
    const f = makeFetch({ ok: true });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    const result = await api.testCommerceConnection("cconn_1");
    expect(capturedUrl(f)).toContain("/commerce/connections/cconn_1/test");
    expect(result.ok).toBe(true);
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
