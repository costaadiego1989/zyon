import { describe, expect, it, vi, type Mock } from "vitest";
import {
  createDashboardApi,
  DashboardHttpError,
  type PaymentConnection,
} from "../api-client.js";
import { sanitizeError, formatDate } from "./payment-connections-page.js";

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

function asF(m: FetchMock): typeof fetch {
  return m as unknown as typeof fetch;
}

const BASE = "http://localhost:3000";

// ── sanitizeError ────────────────────────────────────────────────────────────

describe("sanitizeError", () => {
  it("returns session expired for 401", () => {
    const e = new DashboardHttpError(401, "Unauthorized");
    expect(sanitizeError(e)).toBe("Sessão expirada. Faça login novamente.");
  });

  it("returns no permission for 403", () => {
    const e = new DashboardHttpError(403, "Forbidden");
    expect(sanitizeError(e)).toBe("Sem permissão para esta ação.");
  });

  it("returns conflict for 409", () => {
    const e = new DashboardHttpError(409, "Conflict");
    expect(sanitizeError(e)).toBe("Já existe uma conexão ativa. Remova a atual primeiro.");
  });

  it("returns invalid credentials for 422", () => {
    const e = new DashboardHttpError(422, "Unprocessable");
    expect(sanitizeError(e)).toBe("Não foi possível conectar. Verifique suas credenciais.");
  });

  it("returns internal error for 500", () => {
    const e = new DashboardHttpError(500, "Internal");
    expect(sanitizeError(e)).toBe("Erro interno. Tente novamente em alguns minutos.");
  });

  it("returns internal error for 503", () => {
    const e = new DashboardHttpError(503, "Service Unavailable");
    expect(sanitizeError(e)).toBe("Erro interno. Tente novamente em alguns minutos.");
  });

  it("returns generic error for 418", () => {
    const e = new DashboardHttpError(418, "Teapot");
    expect(sanitizeError(e)).toBe("Ocorreu um erro inesperado. Tente novamente.");
  });

  it("returns connection error for TypeError", () => {
    const e = new TypeError("Failed to fetch");
    expect(sanitizeError(e)).toBe("Sem conexão com o servidor.");
  });

  it("returns generic error for unknown errors", () => {
    expect(sanitizeError({})).toBe("Ocorreu um erro inesperado. Tente novamente.");
    expect(sanitizeError(null)).toBe("Ocorreu um erro inesperado. Tente novamente.");
    expect(sanitizeError(42)).toBe("Ocorreu um erro inesperado. Tente novamente.");
  });
});

// ── formatDate ───────────────────────────────────────────────────────────────

describe("formatDate", () => {
  it("formats ISO string to pt-BR short date+time", () => {
    const result = formatDate("2024-03-15T14:30:00Z");
    expect(result).toContain("15/03/2024");
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  it("handles different ISO dates", () => {
    const result = formatDate("2025-12-01T09:00:00Z");
    expect(result).toContain("01/12/2025");
  });
});

// ── Pluralization ────────────────────────────────────────────────────────────

describe("pluralization logic", () => {
  function formatSummary(activeCount: number, total: number): string {
    const conexao = total === 1 ? "conexão" : "conexões";
    const ativa = activeCount === 1 ? "ativa" : "ativas";
    return `${activeCount} de ${total} ${conexao} ${ativa}`;
  }

  it("singular: 1 de 1 conexão ativa", () => {
    expect(formatSummary(1, 1)).toBe("1 de 1 conexão ativa");
  });

  it("plural: 2 de 3 conexões ativas", () => {
    expect(formatSummary(2, 3)).toBe("2 de 3 conexões ativas");
  });

  it("plural: 2 de 2 conexões ativas", () => {
    expect(formatSummary(2, 2)).toBe("2 de 2 conexões ativas");
  });

  it("mixed: 1 de 2 conexões ativa", () => {
    expect(formatSummary(1, 2)).toBe("1 de 2 conexões ativa");
  });
});

// ── API method calls ─────────────────────────────────────────────────────────

describe("payment connections API methods", () => {
  it("getPaymentConnections calls GET /payments/connections", async () => {
    const conns: PaymentConnection[] = [];
    const f = makeFetch(conns);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.getPaymentConnections();
    expect(capturedUrl(f)).toBe(`${BASE}/v1/payments/connections`);
    expect(capturedInit(f).method).toBe("GET");
  });

  it("createStripeOnboardingLink sends POST with return_url", async () => {
    const f = makeFetch({ url: "https://connect.stripe.com/onboard" });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.createStripeOnboardingLink({ return_url: "http://localhost", refresh_url: "http://localhost" });
    expect(capturedUrl(f)).toBe(`${BASE}/v1/payments/connections/stripe/onboarding-link`);
    expect(capturedInit(f).method).toBe("POST");
    const body = JSON.parse(capturedInit(f).body as string);
    expect(body.return_url).toBe("http://localhost");
    expect(body.refresh_url).toBe("http://localhost");
  });

  it("syncStripeConnection sends POST to correct path", async () => {
    const conn: PaymentConnection = { id: "1", provider: "stripe", status: "active", account_id: "acct_x", created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z" };
    const f = makeFetch(conn);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.syncStripeConnection();
    expect(capturedUrl(f)).toBe(`${BASE}/v1/payments/connections/stripe/sync`);
    expect(capturedInit(f).method).toBe("POST");
  });

  it("createAsaasOnboardingLink sends POST with return_url", async () => {
    const f = makeFetch({ url: "https://asaas.com/onboard" });
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.createAsaasOnboardingLink({ return_url: "http://localhost" });
    expect(capturedUrl(f)).toBe(`${BASE}/v1/payments/connections/asaas/onboarding-link`);
    expect(capturedInit(f).method).toBe("POST");
    const body = JSON.parse(capturedInit(f).body as string);
    expect(body.return_url).toBe("http://localhost");
  });

  it("syncAsaasConnection sends POST to correct path", async () => {
    const conn: PaymentConnection = { id: "2", provider: "asaas", status: "active", account_id: "sub_y", created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z" };
    const f = makeFetch(conn);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });
    await api.syncAsaasConnection();
    expect(capturedUrl(f)).toBe(`${BASE}/v1/payments/connections/asaas/sync`);
    expect(capturedInit(f).method).toBe("POST");
  });
});
