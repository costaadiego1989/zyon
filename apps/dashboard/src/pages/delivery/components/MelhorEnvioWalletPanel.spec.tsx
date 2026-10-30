// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ApiContext } from "../../../hooks/useApi.js";
import type { ShippingWallet } from "../../../api/endpoints/delivery.js";
import { MelhorEnvioWalletPanel } from "./MelhorEnvioWalletPanel.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.innerHTML = ""; });

function wallet(overrides: Partial<ShippingWallet> = {}): ShippingWallet {
  return { status: "ready", environment: "live", rechargeUrl: "https://app.melhorenvio.com.br/melhor-carteira",
    balanceCents: 8025, reservedCents: 1000, debtsCents: 0, checkedAt: "2026-10-30T14:00:00Z", errorCode: null,
    stale: false, lowBalance: false, alert: { enabled: false, thresholdCents: 10000, emailEnabled: false },
    emailRecipient: "owner@example.test", emailDeliveryFailed: false, ...overrides };
}

async function mount(result = wallet()) {
  const api = { getShippingWallet: vi.fn(async (_refresh?: boolean) => result),
    updateShippingWalletAlert: vi.fn(async (settings: ShippingWallet["alert"]) => wallet({ alert: settings })) };
  const reconnect = vi.fn();
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<ApiContext.Provider value={api as never}><MelhorEnvioWalletPanel onReconnect={reconnect} /></ApiContext.Provider>));
  return { host, api, reconnect };
}
const click = async (element: Element) => act(async () => { (element as HTMLElement).click(); });

it("shows the provider balance, explanation and official recharge link with safe new-tab behavior", async () => {
  const h = await mount();
  expect(h.host.textContent).toContain("80,25"); expect(h.host.textContent).toContain("Valor reservado");
  expect(h.host.textContent).toContain("usado para pagar etiquetas de frete");
  const link = h.host.querySelector("a")!;
  expect(link.href).toBe("https://app.melhorenvio.com.br/melhor-carteira"); expect(link.target).toBe("_blank");
  expect(link.rel).toContain("noopener"); expect(h.host.textContent).toContain("mesma conta conectada");
});

it("saves the configured threshold in cents and optional email without enabling alerts by default", async () => {
  const h = await mount();
  const check = h.host.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(check.checked).toBe(false);
  await click(check);
  const threshold = h.host.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(threshold, "75,50");
    threshold.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(h.host.querySelectorAll('input[type="checkbox"]')[1]);
  await act(async () => h.host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(h.api.updateShippingWalletAlert).toHaveBeenCalledWith({ enabled: true, thresholdCents: 7550, emailEnabled: true });
  expect(h.host.textContent).toContain("Alerta salvo."); expect(h.host.textContent).toContain("owner@example.test");
});

it("refreshing the balance preserves unsaved alert settings", async () => {
  const h = await mount(); await click(h.host.querySelector('input[type="checkbox"]')!);
  await click(h.host.querySelector('button[aria-label="Atualizar saldo do Melhor Envio"]')!);
  expect(h.api.getShippingWallet).toHaveBeenLastCalledWith(true);
  expect((h.host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
});

it("reports a failed query as unavailable, never as zero, and permits reconnection", async () => {
  const h = await mount(wallet({ status: "unavailable", balanceCents: null, reservedCents: null, errorCode: "permission_denied" }));
  expect(h.host.textContent).toContain("Saldo indisponível"); expect(h.host.textContent).not.toMatch(/R\$\s*0,00/);
  const reconnect = Array.from(h.host.querySelectorAll("button")).find(button => button.textContent?.includes("Reconectar conta"))!;
  await click(reconnect); expect(h.reconnect).toHaveBeenCalledOnce();
  h.api.getShippingWallet.mockRejectedValueOnce(new Error("offline"));
  await click(h.host.querySelector('button[aria-label="Atualizar saldo do Melhor Envio"]')!);
  expect(h.host.textContent).toContain("Tente atualizar novamente");
});

it("invalid settings stay on screen after save failure and invalid amounts never reach the API", async () => {
  const h = await mount(); await click(h.host.querySelector('input[type="checkbox"]')!);
  h.api.updateShippingWalletAlert.mockRejectedValueOnce(new Error("offline"));
  await act(async () => h.host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(h.host.textContent).toContain("Seus ajustes foram mantidos");
  expect((h.host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  const threshold = h.host.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(threshold, "0");
    threshold.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => h.host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(h.api.updateShippingWalletAlert).toHaveBeenCalledTimes(1);
  expect(h.host.textContent).toContain("O limite deve ficar entre");
});

it("clearly identifies sandbox credits and refuses unexpected recharge destinations", async () => {
  const h = await mount(wallet({ environment: "test", rechargeUrl: "https://sandbox.melhorenvio.com.br/painel/melhor-carteira" }));
  expect(h.host.textContent).toContain("Estes créditos não podem ser usados em envios reais");
  expect(h.host.querySelector("a")!.href).toContain("sandbox.melhorenvio.com.br");
  h.api.getShippingWallet.mockResolvedValueOnce(wallet({ rechargeUrl: "https://untrusted.example" }));
  await click(h.host.querySelector('button[aria-label="Atualizar saldo do Melhor Envio"]')!);
  expect(h.host.querySelector("a")).toBeNull();
});

it("discards a wallet response from the previous API context after a store switch", async () => {
  let resolvePrevious!: (value: ShippingWallet) => void;
  const previousApi = { getShippingWallet: () => new Promise<ShippingWallet>(resolve => { resolvePrevious = resolve; }) };
  const currentApi = { getShippingWallet: async () => wallet({ balanceCents: 25000 }) };
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  const render = (api: unknown) => <ApiContext.Provider value={api as never}><MelhorEnvioWalletPanel onReconnect={() => {}} /></ApiContext.Provider>;
  await act(async () => root.render(render(previousApi)));
  await act(async () => root.render(render(currentApi)));
  expect(host.textContent).toContain("250,00");
  await act(async () => resolvePrevious(wallet({ balanceCents: 8025 })));
  expect(host.textContent).toContain("250,00"); expect(host.textContent).not.toContain("80,25");
});
