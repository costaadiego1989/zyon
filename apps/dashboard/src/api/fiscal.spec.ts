import { describe, expect, it } from "vitest";
import {
  fiscalEndpoints,
  FiscalApiError,
  fiscalPaymentSourceLabel,
} from "./fiscal.js";
const environment = "homologation" as const;
function fixture(body: unknown = {}, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(body, { status });
  }) as typeof fetch;
  return {
    api: fiscalEndpoints("https://api.example.test/v1", fetcher),
    calls,
  };
}
describe("typed fiscal dashboard contract", () => {
  it("FISCAL-01 uses existing session transport for provider and original connection reads", async () => {
    const a = fixture(null);
    expect(await a.api.getFiscalConnection(environment)).toBeNull();
    await a.api.getFiscalProviders(environment);
    expect(a.calls.map((c) => c.url)).toEqual([
      "https://api.example.test/v1/merchants/me/fiscal/connection?environment=homologation",
      "https://api.example.test/v1/merchants/me/fiscal/providers?environment=homologation",
    ]);
    expect(a.calls.every((c) => c.init?.credentials === "include")).toBe(true);
  });
  it("FISCAL-01 company credentials stay only in the protected JSON body", async () => {
    const a = fixture();
    await a.api.connectFiscal({
      environment,
      provider: "focus",
      issuerTaxId: "12ABC34501DE35",
      credential: {
        kind: "company_token",
        secret: "private-original-company-token",
      },
      stockOwner: "zyon",
      emailOwner: "zyon",
      whatsappOwner: "zyon",
    });
    expect(a.calls[0].url).not.toContain("private-original-company-token");
    expect(a.calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(a.calls[0].init?.body)).credential.secret).toBe(
      "private-original-company-token"
    );
    expect(new Headers(a.calls[0].init?.headers).has("Idempotency-Key")).toBe(
      true
    );
  });
  it("FISCAL-01 inspect activate reconnect disconnect retain the same encoded original connection", async () => {
    const a = fixture();
    await a.api.inspectFiscalConnection("original/id", environment);
    await a.api.activateFiscalConnection("original/id", environment);
    await a.api.reconnectFiscalConnection("original/id", environment, {
      kind: "oauth",
      secret: "private-original-refresh",
    });
    await a.api.disconnectFiscalConnection("original/id", environment);
    expect(a.calls.map((c) => c.init?.method)).toEqual([
      "POST",
      "POST",
      "POST",
      "DELETE",
    ]);
    expect(a.calls.every((c) => c.url.includes("original%2Fid"))).toBe(true);
    expect(
      a.calls.every((c) => !c.url.includes("private-original-refresh"))
    ).toBe(true);
  });
  it("FISCAL-01 original setup and responsible profile confirmation use protected explicit lifecycle", async () => {
    const a = fixture();
    await a.api.getFiscalSetup("conn", environment);
    await a.api.saveFiscalSetup("conn", {
      environment,
      fiscalTimeZone: "America/Sao_Paulo",
      paymentConfiguration: {
        intentId: "original-note",
        confirmed: true,
        environment: "test",
        acquirerTaxId: "12345678000195",
      },
    });
    await a.api.confirmFiscalProfile("profile", environment);
    expect(a.calls[1].init?.method).toBe("PUT");
    expect(
      JSON.parse(String(a.calls[1].init?.body)).paymentConfiguration.intentId
    ).toBe("original-note");
    expect(a.calls[2].url).toContain("/profiles/profile/confirm");
    expect(JSON.parse(String(a.calls[2].init?.body))).toEqual({ environment });
  });
  it("FISCAL-57 sends search state and page to backend and returns its counts without local filtering", async () => {
    const page = {
        items: [{ id: "note", state: "authorized" }],
        total: 901,
        counts: { authorized: 700, processing: 201 },
        page: 3,
        pageSize: 1,
      },
      a = fixture(page);
    expect(
      await a.api.getFiscalInvoices(environment, {
        state: "authorized",
        search: "Pedido & Loja",
        page: 3,
        pageSize: 1,
      })
    ).toEqual(page);
    const url = new URL(a.calls[0].url);
    expect(url.searchParams.get("search")).toBe("Pedido & Loja");
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("state")).toBe("authorized");
  });
  it("FISCAL-58 retains authorized NF stock pending and channel failures as distinct persisted outcomes", async () => {
    const detail = {
        id: "note",
        state: "authorized",
        stock: {
          owner: "provider",
          state: "awaiting_provider_evidence",
          reasonCode: "fiscal_stock_evidence_pending",
        },
        deliveries: [
          { channel: "email", state: "failed" },
          { channel: "whatsapp", state: "delivered" },
        ],
        allowedActions: [{ kind: "erp_panel", label: "Cancelar no ERP" }],
      },
      a = fixture(detail);
    expect(await a.api.getFiscalInvoice("note", environment)).toEqual(detail);
    expect(a.calls).toHaveLength(1);
    expect(a.calls[0].init?.method).toBe("GET");
  });
  it("FISCAL-35 original reconcile and correction send only the explicit action inputs", async () => {
    const a = fixture();
    await a.api.reconcileFiscalInvoice("note", environment);
    await a.api.reprocessFiscalInvoice(
      "note",
      environment,
      "confirmed-original-profile"
    );
    expect(a.calls.map((c) => c.url.split("/").pop())).toEqual([
      "reconcile",
      "reprocess",
    ]);
    expect(JSON.parse(String(a.calls[1].init?.body))).toEqual({
      environment,
      profileVersionId: "confirmed-original-profile",
    });
  });
  it("FISCAL-52 cancellation requires explicit original review confirmation and justification without inferred success", async () => {
    const a = fixture(
      { code: "fiscal_cancellation_verification_pending" },
      409
    );
    await expect(
      a.api.requestFiscalCancellation("note", environment, {
        reviewId: "review",
        confirmed: true,
        justification: "Confirmação explícita do responsável",
      })
    ).rejects.toMatchObject({
      kind: "pending",
      code: "fiscal_cancellation_verification_pending",
      status: 409,
    });
    expect(JSON.parse(String(a.calls[0].init?.body))).toEqual({
      environment,
      reviewId: "review",
      confirmed: true,
      justification: "Confirmação explícita do responsável",
    });
  });
  it("FISCAL-40 downloads private bytes through the authenticated transport without provider links", async () => {
    let sent: RequestInit | undefined;
    const api = fiscalEndpoints("https://api.example.test", (async (
      url,
      init
    ) => {
      expect(String(url)).toBe(
        "https://api.example.test/v1/merchants/me/fiscal/invoices/note/documents/danfe?environment=homologation"
      );
      sent = init;
      return new Response("%PDF-original", {
        headers: { "content-type": "application/pdf" },
      });
    }) as typeof fetch);
    const result = await api.downloadFiscalDocument(
      "note",
      environment,
      "danfe"
    );
    expect(await result.blob.text()).toBe("%PDF-original");
    expect(result.fileName).toBe("nota-fiscal.pdf");
    expect(sent?.credentials).toBe("include");
  });
  it("FISCAL-58 forbidden and unavailable remain distinguishable without raw diagnostic payload", async () => {
    for (const [status, kind] of [
      [403, "forbidden"],
      [503, "unavailable"],
    ] as const) {
      const a = fixture(
        { code: "foreign_private_body", token: "private-provider-token" },
        status
      );
      try {
        await a.api.getFiscalInvoice("note", environment);
        throw new Error("expected failure");
      } catch (e) {
        expect(e).toBeInstanceOf(FiscalApiError);
        expect(e).toMatchObject({ status, kind });
        expect(JSON.stringify(e)).not.toContain("private-provider-token");
        expect((e as FiscalApiError).message).not.toContain(
          "private-provider-token"
        );
      }
    }
  });
  it("FISCAL-01 readiness conflict retains only concrete safe pending checks", async () => {
    const a = fixture(
      {
        code: "fiscal_connection_not_ready",
        pending: ["issuer", "permissions", "private-provider-token"],
        secret: "private-A1",
      },
      409
    );
    await expect(
      a.api.activateFiscalConnection("conn", environment)
    ).rejects.toMatchObject({
      code: "fiscal_connection_not_ready",
      kind: "pending",
      pending: ["issuer", "permissions"],
    });
  });
  it("FISCAL-56 source labels use provider method date and never opaque payment or account identity", async () => {
    const source = {
        intentId: "opaque-note",
        provider: "asaas" as const,
        method: "pix",
        status: "approved",
        createdAt: "2026-11-16T12:00:00Z",
      },
      a = fixture([source]);
    expect(
      await a.api.getFiscalPaymentSources(environment, "original-note")
    ).toEqual([source]);
    expect(new URL(a.calls[0].url).searchParams.get("intentId")).toBe(
      "original-note"
    );
    const label = fiscalPaymentSourceLabel(source);
    expect(label).toContain("Asaas");
    expect(label).toContain("Pix");
    expect(label).toContain("16/11/2026");
    expect(label).not.toContain("opaque-note");
  });
  it("FISCAL-01 fiscal template lifecycle never initializes broad post-sale templates", async () => {
    const a = fixture();
    await a.api.getFiscalTemplates();
    await a.api.saveFiscalTemplate("email", {
      body: "Pedido {{orderId}} {{link}}",
      subject: "Nota {{orderId}}",
      revision: 1,
    });
    await a.api.submitFiscalWhatsAppTemplate();
    expect(a.calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/v1/merchants/me/fiscal/templates",
      "/v1/merchants/me/fiscal/templates/email",
      "/v1/merchants/me/fiscal/templates/whatsapp/submit",
    ]);
  });
  it("FISCAL-58 invalid JSON and network errors produce safe recoverable client errors", async () => {
    for (const fetcher of [
      async () => new Response("private invalid provider payload"),
      async () => {
        throw new Error("private network credential");
      },
    ]) {
      const api = fiscalEndpoints(
        "https://api.example.test",
        fetcher as typeof fetch
      );
      await expect(api.getFiscalConnection(environment)).rejects.toMatchObject({
        kind: "unavailable",
      });
    }
  });
  it("FISCAL-21 reloads persisted draft and confirmed profile with server-reviewed contract metadata", async () => {
    const value = {
        profile: { id: "draft", confirmedAt: null },
        confirmedProfile: { id: "original-confirmed", confirmedBy: "owner" },
        supportedContract: {
          sourceContractVersion: "reviewed-server-contract",
          operations: ["sale"],
        },
      },
      a = fixture(value);
    expect(await a.api.getFiscalProfiles(environment, "focus")).toEqual(value);
    const url = new URL(a.calls[0].url);
    expect(url.pathname).toBe("/v1/merchants/me/fiscal/profiles");
    expect(url.searchParams.get("provider")).toBe("focus");
    expect(url.searchParams.get("operation")).toBe("sale");
    expect(url.searchParams.has("merchantId")).toBe(false);
  });
  it("FISCAL-01 original session refresh retries the same fiscal read with protected bearer transport", async () => {
    const urls: string[] = [];
    let reads = 0;
    const api = fiscalEndpoints("https://api.example.test", (async (
      url,
      init
    ) => {
      urls.push(String(url));
      if (String(url).endsWith("/auth/refresh"))
        return Response.json({ access_token: "synthetic-original-session" });
      if (++reads === 1) return Response.json({}, { status: 401 });
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer synthetic-original-session"
      );
      return Response.json(null);
    }) as typeof fetch);
    expect(await api.getFiscalConnection(environment)).toBeNull();
    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe(urls[2]);
    expect(
      urls.every((url) => !url.includes("synthetic-original-session"))
    ).toBe(true);
  });
});
