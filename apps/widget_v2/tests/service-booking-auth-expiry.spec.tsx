// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { ServiceBookingPicker } from "../src/components/checkout/ServiceBookingPicker";

// T45 authorization negatives: a rejected authorization must remove the prior
// private review, with no mutation replay; public choices remain public.
const access = { merchantId: "tenant-expiry", embedToken: "signed-expiry", buyerAccessToken: "buyer-expiry", globalUserId: "buyer-one", apiBaseUrl: "https://fixture.invalid" };
const data = { kind: "professionals", context: { productId: "service-one", variantId: "variant-one", serviceName: "Consulta" } };
const tuple = { productId: "service-one", variantId: "variant-one", professionalId: "professional-one", professionalVersion: 2, policyVersion: 3, date: "2026-12-03", startsAt: "2026-12-03T13:00:00Z", endsAt: "2026-12-03T13:30:00Z", timeZone: "America/Sao_Paulo", durationMinutes: 30, priceInCents: 5000, currency: "BRL", slotId: "a".repeat(64) };
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let rejectStatus: 401 | 403 | undefined;
let rejectPath: "/prepare" | "/confirm";
let requests: string[];
function button(label: string | RegExp) {
  const found = Array.from(document.querySelectorAll("button")).find(node => typeof label === "string" ? node.textContent === label : label.test(node.textContent ?? ""));
  if (!found) throw new Error(`Missing control: ${label}`);
  return found;
}
async function click(label: string | RegExp) { await act(async () => button(label).click()); }
beforeEach(() => {
  requests = []; rejectStatus = undefined;
  globalThis.fetch = async (input) => {
    const url = String(input); requests.push(url);
    if (rejectStatus && url.endsWith(rejectPath)) return Response.json({ code: rejectStatus === 401 ? "buyer_token_expired" : "checkout_scope_forbidden" }, { status: rejectStatus });
    if (url.includes("/professionals")) return Response.json({ professionals: [{ id: tuple.professionalId, name: "Profissional privado de teste", version: 2, timeZone: tuple.timeZone }], has_more: false });
    if (url.includes("/dates")) return Response.json({ dates: [tuple.date], professional_version: 2, policy_version: 3, time_zone: tuple.timeZone });
    if (url.includes("/slots")) return Response.json({ selections: [tuple] });
    if (url.endsWith("/select")) return Response.json({ selection: tuple, service: { name: "Consulta" }, professional: { name: "Profissional privado de teste" }, parent_cart_fingerprint: "b".repeat(64), policy: { version: 3, paymentMode: "at_attendance", holdEnabled: false, holdMinutes: null } });
    if (url.endsWith("/prepare")) return Response.json({ session_id: "session-expiry", replayed: false, confirmed: false, cart_fingerprint: "c".repeat(64), payment_mode: "at_attendance", policy_version: 3, requires_hold: false, service_slot_hold: null, selections: [{ ...tuple, productName: "Consulta", professionalName: "Profissional privado de teste" }] });
    throw new Error("Unexpected transport");
  };
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove(); root = undefined; host = undefined; globalThis.fetch = originalFetch;
});
describe("T45 expired or revoked service-booking authorization", () => {
  for (const status of [401, 403] as const) for (const path of ["/prepare", "/confirm"] as const) {
    it(`clears the private review after HTTP ${status} from ${path} without another write`, async () => {
      host = document.createElement("div"); document.body.append(host); root = createRoot(host);
      await act(async () => root!.render(<ServiceBookingPicker data={data} access={access} initialFromDate="2026-12-01" />));
      await click("Profissional privado de teste"); await click(/3 de dezembro/); await click(/10:00/); await click("Continuar agendamento");
      expect(document.querySelector("dl")?.textContent).toContain("Profissional privado de teste");
      expect(document.querySelector("dl")?.textContent).toContain("30 minutos");
      if (path === "/confirm") await click("Revisar agendamento");
      rejectStatus = status; rejectPath = path;
      await click(path === "/prepare" ? "Revisar agendamento" : "Confirmar e pagar no atendimento");
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(status === 401 ? "identificação precisa ser atualizada" : "não permite iniciar outro agendamento");
      expect(document.querySelector("dl")).toBeNull();
      expect(document.body.textContent).not.toContain("Profissional privado de teste");
      expect(document.body.textContent).not.toContain("3 de dezembro");
      expect(document.body.textContent).not.toContain("30 minutos");
      expect(Array.from(document.querySelectorAll("button")).some(node => /Revisar agendamento|Confirmar e pagar|Continuar para pagamento/.test(node.textContent ?? ""))).toBe(false);
      expect(requests.filter(url => url.endsWith(path))).toHaveLength(1);
      expect(requests.filter(url => url.endsWith("/confirm"))).toHaveLength(path === "/confirm" ? 1 : 0);
      expect(requests).toHaveLength(path === "/confirm" ? 9 : 8);
    });
  }
});
