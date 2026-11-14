// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MerchantProfile } from "../api-client.js";
import { BillingPage } from "./billing-page.js";

const api = vi.hoisted(() => ({ getBillingSubscription: vi.fn(), listBillingInvoices: vi.fn() }));
vi.mock("../hooks/useApi.js", () => ({ useApi: () => api }));
let container: HTMLDivElement;
let root: Root;
const merchant = { id: "merchant-ui" } as MerchantProfile;
const invoice = { invoice_id: "invoice-1", amount_brl: 749, status: "paid", created_at: "2026-09-01T12:00:00Z", period_start: "2026-08-01T12:00:00Z", period_end: "2026-09-01T12:00:00Z", invoice_url: "https://example.test/invoice-1" };
async function render(me: MerchantProfile | null = merchant) {
  await act(async () => { root.render(createElement(BillingPage, { apiBaseUrl: "https://example.test", me })); });
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(el => el.getAttribute("aria-label") === label || el.textContent === label);
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  api.getBillingSubscription.mockReset().mockResolvedValue({ plan: "scale", plan_name: "Scale", status: "active", billing_provider: "stripe" });
  api.listBillingInvoices.mockReset().mockResolvedValue([]);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("Histórico de cobranças", () => {
  it("orienta a entrar sem consultar dados quando não há merchant", async () => {
    await render(null);
    expect(container.textContent).toContain("Entre para consultar as cobranças");
    expect(api.listBillingInvoices).not.toHaveBeenCalled();
    expect(container.querySelector('a[href="#billing-plans"]')).not.toBeNull();
  });
  it("distingue a consulta em andamento de um histórico vazio", async () => {
    api.listBillingInvoices.mockReturnValue(new Promise(() => {}));
    await render();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Consultando cobranças");
    expect(container.textContent).not.toContain("Nenhuma fatura disponível");
  });
  it("preserva a assinatura quando as faturas falham e permite tentar novamente", async () => {
    api.listBillingInvoices.mockRejectedValueOnce(new Error("network"));
    await render();
    expect(container.textContent).toContain("Scale");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Não foi possível carregar as faturas");
    expect(container.textContent).not.toContain("Nenhuma fatura disponível");
    api.listBillingInvoices.mockResolvedValue([invoice]);
    await click("Tentar novamente");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("mantém faturas quando a assinatura falha, filtra e pagina dados retornados", async () => {
    api.getBillingSubscription.mockRejectedValue(new Error("network"));
    api.listBillingInvoices.mockResolvedValue(Array.from({ length: 13 }, (_, i) => ({ ...invoice, invoice_id: "invoice-" + i, status: i < 11 ? "paid" : "open", invoice_url: i === 0 ? "javascript:alert(1)" : invoice.invoice_url })));
    await render();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(container.textContent).toContain("749,00");
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    await click("Próxima página");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    const select = container.querySelector("select")!;
    await act(async () => { select.value = "open"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.textContent).toContain("Página 1 de 1");
  });
  it("distingue um provedor sem histórico disponível de uma resposta vazia do Stripe", async () => {
    api.getBillingSubscription.mockResolvedValue({ plan: "scale", status: "active", billing_provider: "asaas" });
    await render();
    expect(container.textContent).toContain("Histórico deste provedor indisponível aqui");
    expect(container.textContent).not.toContain("Nenhuma fatura disponível");
  });
});
