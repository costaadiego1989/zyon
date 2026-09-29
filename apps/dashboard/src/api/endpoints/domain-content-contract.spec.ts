import { describe, expect, it } from "vitest";
import { merchantEndpoints } from "./merchants.js";
import { catalogEndpoints } from "./catalog.js";
import { DashboardHttpError } from "../http/index.js";
import { domainErrorMessage } from "../../pages/custom-domains/domain-errors.js";
import { contentLoadError } from "../../pages/advanced-layout/content-load-error.js";

describe("domain and product content API contracts", () => {
  it("reads the domain array with both provider records and ownership-gated verification", async () => {
    const domain = { id: "domain-a", domain: "shop.example.com", verified: false,
      cname_target: "stores.example.com", txt_name: "_zyon-verification.shop.example.com",
      txt_value: "zyon-verification=fixture", created_at: "2026-09-29T00:00:00.000Z" };
    const requests: Array<{ url: string; method?: string; credentials?: RequestCredentials }> = [];
    const api = merchantEndpoints("https://api.example.test", async (url, init) => {
      requests.push({ url: String(url), method: init?.method, credentials: init?.credentials });
      return new Response(JSON.stringify([domain]));
    });
    expect(await api.listDomains()).toEqual([domain]);
    expect(requests).toEqual([{ url: "https://api.example.test/v1/merchants/me/domains", method: "GET", credentials: "include" }]);
  });

  it("reads the layout summary shape returned by ProductLayoutStatusController", async () => {
    const body = { entries: [{ productId: "product-a", blockCount: 2, enabledBlockCount: 1,
      faqCount: 3, testimonialCount: 0, videoCount: 1, lastUpdatedAt: "2026-09-29T00:00:00.000Z" }], total: 1 };
    const requests: string[] = [];
    const api = catalogEndpoints("https://api.example.test", async (url, init) => {
      requests.push(String(init?.method) + " " + String(url)); return new Response(JSON.stringify(body));
    });
    expect(await api.getProductsWithLayoutStatus("merchant/a")).toEqual(body);
    expect(requests).toEqual(["GET https://api.example.test/v1/merchants/merchant%2Fa/products/layout-status"]);
  });

  it("does not turn a failed domain request into an empty or verified list", async () => {
    const api = merchantEndpoints("https://api.example.test", async () => new Response(JSON.stringify({ code: "internal_error" }), { status: 500 }));
    await expect(api.listDomains()).rejects.toMatchObject({ status: 500 });
  });

  it("keeps technical details out of merchant error copy while explaining recovery", () => {
    const failure = new DashboardHttpError(500, 'Prisma P2032 password=do-not-display');
    expect(domainErrorMessage(failure, "load")).toContain("carregar os domínios");
    expect(domainErrorMessage(failure, "add")).toContain("endereço foi mantido");
    expect(domainErrorMessage(failure, "remove")).toContain("continua na lista");
    expect(contentLoadError(new DashboardHttpError(404, "product_not_found"))).not.toContain("dashboard_http");
    for (const message of [domainErrorMessage(failure, "verify"), contentLoadError(failure)]) {
      expect(message).not.toMatch(/Prisma|P2032|password|do-not-display/);
    }
    expect(domainErrorMessage(new DashboardHttpError(503, "dns_verification_unavailable"), "verify")).toContain("dados do domínio foram preservados");
    expect(domainErrorMessage(new DashboardHttpError(403, "forbidden"), "verify")).toContain("permissões");
    expect(contentLoadError(new DashboardHttpError(0, "network_error"))).toContain("conexão");
  });
});
