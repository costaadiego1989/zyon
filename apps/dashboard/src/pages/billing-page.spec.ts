/**
 * Unit tests for BillingPage — billing-page.tsx
 * Validates: Portuguese diacritics, price_id passing, structural correctness.
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
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () =>
      Promise.resolve(
        typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody),
      ),
  } as Response) as FetchMock;
}

function capturedInit(fetchMock: FetchMock): RequestInit {
  return (fetchMock.mock.calls[0] as [string, RequestInit])[1] as RequestInit;
}

function asF(m: FetchMock): typeof fetch {
  return m as unknown as typeof fetch;
}

const BASE = "http://localhost:3000";

// ── Portuguese diacritics validation ─────────────────────────────────────────

describe("BillingPage Portuguese copy", () => {
  // We import the module source to validate string constants
  // Using a dynamic approach — read the file content via the PLANS export
  // Since PLANS is not exported, we'll validate via the built module

  const BROKEN_PATTERNS = [
    { wrong: /\bnecessario\b/i, correct: "necessário" },
    { wrong: /\bhistorico\b/i, correct: "histórico" },
    { wrong: /\bRenovacao\b/, correct: "Renovação" },
    { wrong: /\bperiodo\b/i, correct: "período" },
    { wrong: /\bcomecar\b/i, correct: "começar" },
    { wrong: /\binstalacao\b/i, correct: "instalação" },
    { wrong: /\binstalacoes\b/i, correct: "instalações" },
    { wrong: /\bsessoes\b/i, correct: "sessões" },
    { wrong: /\bbasicos\b/i, correct: "básicos" },
    { wrong: /\/mo\b/, correct: "/mês" },
  ];

  // Read the source file to validate strings
  it("source file contains no broken Portuguese patterns", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    for (const { wrong, correct } of BROKEN_PATTERNS) {
      const matches = source.match(wrong);
      expect(
        matches,
        `Found broken pattern ${wrong} — should be "${correct}"`,
      ).toBeNull();
    }
  });

  it("source file contains correct diacritics for all plan features", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    // These correct strings must be present
    const requiredStrings = [
      "1 instalação",
      "5 instalações",
      "500 sessões/mês",
      "10k sessões/mês",
      "Instalações ilimitadas",
      "Sessões ilimitadas",
      "Webhooks básicos",
      "R$ 299/mês",
      "R$ 899/mês",
      "Login necessário",
      "histórico de cobranças",
      "Renovação",
      "período",
      "começar",
    ];

    for (const str of requiredStrings) {
      expect(source, `Missing correct string: "${str}"`).toContain(str);
    }
  });
});

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
        sessions_current: 4500,
        sessions_limit: 10000,
        installations_current: 3,
        installations_limit: 5,
      },
    };
    expect(sub.usage?.sessions_current).toBe(4500);
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
        sessions_current: null,
        sessions_limit: null,
        installations_current: null,
        installations_limit: null,
      },
    };
    expect(sub.usage?.sessions_current).toBeNull();
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

// ── PLANS structure validation ───────────────────────────────────────────────

describe("BillingPage PLANS structure", () => {
  it("source defines priceId field for each plan", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain('priceId: "starter"');
    expect(source).toContain('priceId: "growth"');
    expect(source).toContain('priceId: "scale"');
  });

  it("source uses plan-features CSS class instead of inline styles on feature list", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain('"plan-features"');
  });

  it("source uses plan-highlighted CSS class instead of inline border style", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain("plan-highlighted");
  });

  it("source uses plan-price CSS class instead of inline font styles", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain('"plan-price"');
  });

  it("source uses ops-grid three-col class", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain('"ops-grid three-col"');
  });

  it("source has aria-live polite region", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="status"');
  });

  it("source renders invoice history section", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain("Histórico de faturas");
    expect(source).toContain("Nenhuma fatura encontrada");
  });

  it("source renders payment method section", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain("Método de pagamento");
    expect(source).toContain("Nenhum método cadastrado");
  });

  it("source renders unauthenticated state with panel-info class", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain("panel panel-info");
    expect(source).toContain("Faça login para acessar informações de faturamento");
  });

  it("openCheckout function accepts priceId parameter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toMatch(/async function openCheckout\(priceId: string\)/);
    expect(source).toContain("price_id: priceId");
  });

  it("plan card buttons pass plan.priceId to openCheckout", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    expect(source).toContain("openCheckout(plan.priceId)");
  });

  it("source has no inline style on ops-grid container", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.resolve(
      import.meta.dirname ?? ".",
      "billing-page.tsx",
    );
    const source = fs.readFileSync(filePath, "utf-8");

    // Should NOT have inline gridTemplateColumns
    expect(source).not.toContain('gridTemplateColumns');
  });
});
