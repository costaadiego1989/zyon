// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { ServiceBookingPicker } from "../src/components/checkout/ServiceBookingPicker";

const access = { merchantId: "tenant-a", embedToken: "real-signed-embed", buyerAccessToken: "real-buyer", globalUserId: "buyer-a", apiBaseUrl: "https://fixture.invalid" };
const context = { productId: "offer-a", variantId: "variant-a", serviceName: "Consulta" };
const tuple = { ...context, serviceName: undefined, professionalId: "professional-a", professionalVersion: 2, policyVersion: 3, date: "2026-12-03", startsAt: "2026-12-03T13:00:00Z", endsAt: "2026-12-03T13:30:00Z", timeZone: "America/Sao_Paulo", durationMinutes: 30, priceInCents: 5000, currency: "BRL", slotId: "a".repeat(64) };
const data = { kind: "professionals", context };
let calls: Array<{ url: string; body: Record<string, unknown> | undefined; headers: Headers }>;
let mode = "at_attendance";
let failure: "conflict" | "uncertain" | null = null;
let expiredHold = false;
const originalFetch = globalThis.fetch;
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
const contains = (value: string | RegExp) => Array.from(document.querySelectorAll("p,h4,dd")).some(node => typeof value === "string" ? node.textContent === value : value.test(node.textContent ?? ""));
function button(value: string | RegExp) { const result = Array.from(document.querySelectorAll("button")).find(node => typeof value === "string" ? node.textContent === value : value.test(node.textContent ?? "")); if (!result) throw new Error(`Button not found: ${value}`); return result; }
async function click(value: string | RegExp) { await act(async () => { button(value).click(); }); }
async function cleanup() { for (const item of mounts.splice(0)) { await act(async () => item.root.unmount()); item.host.remove(); } }
async function render(element: React.ReactNode) { const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host }); await act(async () => root.render(element)); return { rerender: async (next: React.ReactNode) => { await act(async () => root.render(next)); } }; }
beforeEach(() => {
  calls = []; mode = "at_attendance"; failure = null; expiredHold = false;
  globalThis.fetch = vi.fn(async (input, init) => {
    const url = String(input); const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body, headers: new Headers(init?.headers) });
    if (url.includes("/professionals")) return Response.json({ professionals: [{ id: "professional-a", name: "Dra. Ana", version: 2, timeZone: "America/Sao_Paulo" }], has_more: false });
    if (url.includes("/dates")) return Response.json({ dates: ["2026-12-03"], professional_version: 2, policy_version: 3, time_zone: "America/Sao_Paulo" });
    if (url.includes("/slots")) return Response.json({ selections: [tuple] });
    if (url.endsWith("/select")) return failure === "conflict" ? Response.json({ code: "service_slot_unavailable" }, { status: 409 }) : Response.json({ selection: tuple, service: { name: "Consulta" }, professional: { name: "Dra. Ana" }, parent_cart_fingerprint: "b".repeat(64), policy: { version: 3, paymentMode: mode, holdEnabled: expiredHold, holdMinutes: expiredHold ? 4 : null } });
    if (url.endsWith("/prepare")) { if (failure === "uncertain") throw new TypeError("network lost"); return Response.json({ session_id: "session-a", replayed: false, confirmed: false, cart_fingerprint: "c".repeat(64), payment_mode: mode, policy_version: 3, requires_hold: expiredHold, service_slot_hold: expiredHold ? { expiresAt: new Date(Date.now() - 1000).toISOString(), slots: [{ resourceId: "professional:professional-a", slotId: tuple.slotId, startsAt: tuple.startsAt, endsAt: tuple.endsAt }] } : null, selections: [{ ...tuple, productName: "Consulta", professionalName: "Dra. Ana" }] }); }
    if (url.endsWith("/confirm")) return Response.json({ replayed: false, appointments: [{ id: "appointment-a", ...tuple, operationalStatus: "scheduled", version: 1, payments: [{ id: "balance-a", mode: "at_attendance", status: "pending", amountCents: 5000, currency: "BRL", receivedAt: null, requiresRegularization: false }] }] });
    throw new Error("Unexpected transport");
  });
});
afterEach(async () => { await cleanup(); globalThis.fetch = originalFetch; });
async function choosePublic() { await click("Dra. Ana"); await click(/3 de dezembro/i); await click(/10:00/); button("Continuar agendamento"); }
async function choose() { await choosePublic(); await click("Continuar agendamento"); button("Revisar agendamento"); }
describe("T45 actual service booking controls and authenticated transport", () => {
  it("browses professionals, dates and slots as guest and asks identity only on the explicit continue gesture", async () => {
    const login = vi.fn(); const view = await render(<ServiceBookingPicker data={data} access={null} readAccess={access} onAuthenticate={login} initialFromDate="2026-12-01" />);
    await choosePublic(); expect(login).toHaveBeenCalledTimes(0); expect(calls).toHaveLength(3); expect(calls.every(c => c.body === undefined)).toBe(true);
    expect(contains("30 minutos")).toBe(true); await click("Continuar agendamento"); expect(login).toHaveBeenCalledTimes(1); expect(calls).toHaveLength(3);
    await view.rerender(<ServiceBookingPicker data={{ kind: "professionals", professionals: [] }} access={access} readAccess={access} />);
    expect(calls).toHaveLength(3); expect(contains(/Selecione o serviço novamente/)).toBe(true);
  });
  it("uses distinct select, review and confirm gestures, leaves local payment pending, and keeps private data off screen", async () => {
    await render(<ServiceBookingPicker data={data} access={access} initialFromDate="2026-12-01" />); await choose();
    expect(calls.filter(c => c.url.endsWith("/select"))).toHaveLength(1); expect(calls.filter(c => c.url.endsWith("/prepare"))).toHaveLength(0);
    expect(contains("30 minutos")).toBe(true); expect(contains(/R\$\s*50,00/)).toBe(true);
    await click("Revisar agendamento"); await click("Confirmar e pagar no atendimento");
    expect(contains("Agendamento confirmado")).toBe(true); expect(contains(/Pagamento pendente no atendimento/)).toBe(true);
    expect(calls.filter(c => c.url.endsWith("/confirm"))).toHaveLength(1);
    expect(document.body.textContent).not.toContain("b".repeat(64)); expect(document.body.textContent).not.toContain("real-signed-embed");
    for (const c of calls) { expect(c.headers.get("authorization")).toBe("Bearer real-signed-embed"); expect(c.headers.get("x-buyer-access-token")).toBe("real-buyer"); }
  });
  it("hands online payment to the existing checkout only after explicit action and never calls local confirmation", async () => {
    mode = "online"; const pay = vi.fn(); await render(<ServiceBookingPicker data={data} access={access} initialFromDate="2026-12-01" onCheckout={pay} />); await choose();
    await click("Revisar agendamento"); await click("Continuar para pagamento");
    expect(pay).toHaveBeenCalledTimes(1); expect(pay.mock.calls[0]![0].confirmed).toBe(false); expect(calls.some(c => c.url.endsWith("/confirm"))).toBe(false); expect(contains("Agendamento confirmado")).toBe(false);
  });
  it("keeps conflict and uncertain writes honest without repeating mutations", async () => {
    failure = "conflict"; await render(<ServiceBookingPicker data={data} access={access} initialFromDate="2026-12-01" />);
    await click("Dra. Ana"); await click(/3 de dezembro/i); await click(/10:00/); await click("Continuar agendamento");
    expect(contains(/Este horário ou as condições mudaram/)).toBe(true); expect(calls.filter(c => c.url.endsWith("/select"))).toHaveLength(1); await cleanup();
    failure = "uncertain"; await render(<ServiceBookingPicker data={data} access={access} initialFromDate="2026-12-01" />); await choose(); await click("Revisar agendamento");
    expect(contains(/Não foi possível confirmar o resultado/)).toBe(true); expect(Array.from(document.querySelectorAll("button")).some(n => n.textContent === "Revisar agendamento")).toBe(false); expect(calls.filter(c => c.url.endsWith("/prepare"))).toHaveLength(1);
  });
  it("masks private review and own-hold availability on logout, and discards the choice on merchant change", async () => {
    const view = await render(<ServiceBookingPicker data={data} access={access} readAccess={access} initialFromDate="2026-12-01" />); await choose();
    await view.rerender(<ServiceBookingPicker data={data} access={null} readAccess={access} />);
    expect(Array.from(document.querySelectorAll("button")).some(n => n.textContent === "Revisar agendamento")).toBe(false); expect(contains("30 minutos")).toBe(false); button("Dra. Ana");
    const other = { ...access, merchantId: "tenant-b", embedToken: "tenant-b-token" };
    await view.rerender(<ServiceBookingPicker data={data} access={other} readAccess={other} initialFromDate="2026-12-01" />);
    expect(calls.at(-1)?.headers.get("authorization")).toBe("Bearer tenant-b-token"); expect(contains("30 minutos")).toBe(false);
  });
  it("discards a late old-merchant response even if the transport ignores abort", async () => {
    const ordinary = globalThis.fetch; let release!: (response: Response) => void;
    globalThis.fetch = async (input, init) => String(input).includes("/dates") ? await new Promise<Response>(resolve => { release = resolve; }) : ordinary(input, init);
    const view = await render(<ServiceBookingPicker data={data} access={access} initialFromDate="2026-12-01" />); await click("Dra. Ana");
    await view.rerender(<ServiceBookingPicker data={data} access={{ ...access, merchantId: "tenant-b", embedToken: "tenant-b" }} initialFromDate="2026-12-01" />);
    await act(async () => release(Response.json({ dates: ["2026-12-03"], professional_version: 2, policy_version: 3, time_zone: "America/Sao_Paulo" })));
    expect(Array.from(document.querySelectorAll("button")).some(n => /3 de dezembro/.test(n.textContent ?? ""))).toBe(false); expect(calls.some(c => c.url.includes("/slots"))).toBe(false);
  });
  it("shows server expiry and requires explicit revalidation before any confirmation", async () => {
    expiredHold = true; const review = vi.fn(async () => {});
    await render(<ServiceBookingPicker data={data} access={access} initialFromDate="2026-12-01" onReviewCheckout={review} />); await choose(); await click("Revisar agendamento");
    expect(contains(/A reserva temporária expirou/)).toBe(true); expect(button("Confirmar e pagar no atendimento").disabled).toBe(true); expect(calls.some(c => c.url.endsWith("/confirm"))).toBe(false); expect(review).toHaveBeenCalledTimes(0);
    await click("Revalidar reserva"); expect(review).toHaveBeenCalledTimes(1); expect(calls.some(c => c.url.endsWith("/confirm"))).toBe(false);
  });
  it("resumes only select once after guest identity and revalidates all public facts without preparing", async () => {
    const login = vi.fn((_cancel?: () => void) => {});
    const view = await render(<ServiceBookingPicker data={data} access={null} readAccess={access} cartRef="cart-a" onAuthenticate={login} initialFromDate="2026-12-01" />);
    await choosePublic(); await click("Continuar agendamento"); expect(calls.some(c => c.body !== undefined)).toBe(false);
    await view.rerender(<ServiceBookingPicker data={data} access={access} readAccess={access} cartRef="cart-a" onAuthenticate={login} />);
    await view.rerender(<ServiceBookingPicker data={data} access={access} readAccess={access} cartRef="cart-a" onAuthenticate={login} />);
    button("Revisar agendamento"); expect(contains("30 minutos")).toBe(true);
    expect(calls.filter(c => c.url.includes("/professionals"))).toHaveLength(2); expect(calls.filter(c => c.url.includes("/dates"))).toHaveLength(2); expect(calls.filter(c => c.url.includes("/slots"))).toHaveLength(2);
    expect(calls.filter(c => c.url.endsWith("/select"))).toHaveLength(1); expect(calls.some(c => /\/(prepare|confirm)$/.test(c.url))).toBe(false); expect(login).toHaveBeenCalledTimes(1);
  });
  it("cancelled identity cannot later replay a pending public choice", async () => {
    const login = vi.fn((_cancel?: () => void) => {});
    const view = await render(<ServiceBookingPicker data={data} access={null} readAccess={access} onAuthenticate={login} initialFromDate="2026-12-01" />);
    await choosePublic(); await click("Continuar agendamento"); await act(async () => login.mock.calls[0]![0]!());
    await view.rerender(<ServiceBookingPicker data={data} access={access} readAccess={access} onAuthenticate={login} />);
    expect(calls.some(c => c.body !== undefined)).toBe(false); expect(contains("30 minutos")).toBe(true); button("Continuar agendamento");
  });
  it("a changed public price after identity discards the intent before any private request", async () => {
    const login = vi.fn(); const view = await render(<ServiceBookingPicker data={data} access={null} readAccess={access} onAuthenticate={login} initialFromDate="2026-12-01" />);
    await choosePublic(); await click("Continuar agendamento"); const ordinary = globalThis.fetch;
    globalThis.fetch = async (input, init) => { const response = await ordinary(input, init); return String(input).includes("/slots") ? Response.json({ selections: [{ ...tuple, priceInCents: 5001 }] }) : response; };
    await view.rerender(<ServiceBookingPicker data={data} access={access} readAccess={access} onAuthenticate={login} />);
    expect(calls.some(c => c.body !== undefined)).toBe(false); expect(contains("30 minutos")).toBe(false); button("Atualizar disponibilidade");
  });
  it("changing the cart during identity cannot consume the earlier continue gesture", async () => {
    const login = vi.fn(); const view = await render(<ServiceBookingPicker data={data} access={null} readAccess={access} cartRef="cart-a" onAuthenticate={login} initialFromDate="2026-12-01" />);
    await choosePublic(); await click("Continuar agendamento");
    await view.rerender(<ServiceBookingPicker data={data} access={access} readAccess={access} cartRef="cart-b" onAuthenticate={login} />);
    expect(calls.some(c => c.body !== undefined)).toBe(false); expect(contains("30 minutos")).toBe(false);
  });
  it("buyer A to B to A while a public revalidation ignores abort never dispatches the old select", async () => {
    const login = vi.fn(); const view = await render(<ServiceBookingPicker data={data} access={null} readAccess={access} onAuthenticate={login} initialFromDate="2026-12-01" />);
    await choosePublic(); await click("Continuar agendamento"); const ordinary = globalThis.fetch; let release!: (reply: Response) => void;
    globalThis.fetch = async (input, init) => String(input).includes("/dates") ? await new Promise<Response>(resolve => { release = resolve; }) : ordinary(input, init);
    await view.rerender(<ServiceBookingPicker data={data} access={access} readAccess={access} onAuthenticate={login} />); expect(typeof release).toBe("function");
    await view.rerender(<ServiceBookingPicker data={data} access={{ ...access, globalUserId: "buyer-b", buyerAccessToken: "buyer-b-token" }} readAccess={access} onAuthenticate={login} />);
    await view.rerender(<ServiceBookingPicker data={data} access={access} readAccess={access} onAuthenticate={login} />);
    await act(async () => release(Response.json({ dates: [tuple.date], professional_version: 2, policy_version: 3, time_zone: tuple.timeZone })));
    expect(calls.some(c => c.body !== undefined)).toBe(false); expect(Array.from(document.querySelectorAll("button")).some(n => n.textContent === "Revisar agendamento")).toBe(false);
  });

  it("keeps guest browsing usable without rendering an inert continuation when the host has no identity callback", async () => {
    await render(<ServiceBookingPicker data={data} access={null} readAccess={access} initialFromDate="2026-12-01" />);
    await click("Dra. Ana"); await click(/3 de dezembro/i); await click(/10:00/);
    expect(contains("30 minutos")).toBe(true);
    expect(Array.from(document.querySelectorAll("button")).some(node => node.textContent === "Continuar agendamento")).toBe(false);
    expect(contains("Para confirmar o agendamento, volte à loja e continue sua compra." )).toBe(true);
    expect(calls).toHaveLength(3); expect(calls.some(call => call.body !== undefined)).toBe(false);
  });

  it("starts all independent auth-resume reads together and waits for every result before selecting once", async () => {
    const login = vi.fn();
    const view = await render(<ServiceBookingPicker data={data} access={null} readAccess={access} cartRef="cart-a" onAuthenticate={login} initialFromDate="2026-12-01" />);
    await choosePublic(); await click("Continuar agendamento");
    const ordinary = globalThis.fetch, releases = new Map<string, () => void>();
    let captureReads = true;
    globalThis.fetch = async (input, init) => {
      const kind = /service-booking\/(professionals|dates|slots)(?:\?|$)/.exec(String(input))?.[1];
      if (!captureReads || !kind) return ordinary(input, init);
      expect(new Headers(init?.headers).get("x-buyer-access-token")).toBe("real-buyer");
      return new Promise<Response>((resolve, reject) => { releases.set(kind, () => { releases.delete(kind); void ordinary(input, init).then(resolve, reject); }); });
    };
    try {
      await view.rerender(<ServiceBookingPicker data={data} access={access} readAccess={access} cartRef="cart-a" onAuthenticate={login} />);
      expect([...releases.keys()].sort()).toEqual(["dates", "professionals", "slots"]);
      expect(calls.some(call => call.body !== undefined)).toBe(false);
      await act(async () => releases.get("slots")!());
      await act(async () => releases.get("professionals")!());
      expect(calls.some(call => call.body !== undefined)).toBe(false);
      await act(async () => releases.get("dates")!());
      button("Revisar agendamento");
      await view.rerender(<ServiceBookingPicker data={data} access={access} readAccess={access} cartRef="cart-a" onAuthenticate={login} />);
      expect(calls.filter(call => call.url.endsWith("/select"))).toHaveLength(1);
      expect(calls.some(call => /\/(prepare|confirm)$/.test(call.url))).toBe(false);
    } finally {
      captureReads = false; globalThis.fetch = ordinary;
      await act(async () => { for (const release of releases.values()) release(); });
    }
  });

});
