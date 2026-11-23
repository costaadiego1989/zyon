/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDashboardApi } from "../../../api-client.js";
import { useWhatsAppConversations } from "../useWhatsAppConversations.js";
import { WhatsAppConversationDrawer } from "./WhatsAppConversationDrawer.js";
import type { ConversationContext, ConversationDetail } from "../conversation-types.js";

const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { vi.stubGlobal("crypto", { randomUUID }); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); vi.unstubAllGlobals(); });
const labels = { queued: "Alerta à equipe aguardando envio", accepted: "Alerta à equipe aceito pelo canal", unavailable: "Alerta à equipe indisponível",
  failed: "Falha no alerta à equipe", unknown: "Envio do alerta à equipe sem confirmação", delivered: "Alerta à equipe entregue", read: "Alerta à equipe lido" } as const;
async function fixture(status?: keyof typeof labels) {
  let context: ConversationContext = { merchant_id: "merchant-a", user_id: "operator-a", role: "OWNER" };
  const detail: ConversationDetail = { ticket: { id: "ticket-a", status: "in_progress", buyerMessage: "Pedido original", createdAt: "2026-11-20T10:00:00Z", updatedAt: "2026-11-20T10:00:00Z" },
    binding: { id: "binding-a", ticketId: "ticket-a", mode: "human", epoch: 2, assignedOperatorId: "operator-a", configId: "config-a", whatsappSessionId: "session-a" },
    channel: { id: "config-a", provider: "META_CLOUD", enabled: true, status: "ACTIVE" }, has_more: false, next_cursor: null,
    messages: [{ id: "reply-a", ticketId: "ticket-a", senderType: "merchant", content: "Resposta anterior", createdAt: "2026-11-20T10:00:00Z", delivery: { status: "delivered", revision: 1 } }],
    ...(status ? { staffAlert: { status, revision: 1 } } : {}) };
  let vm!: ReturnType<typeof useWhatsAppConversations>, changed: (event: unknown) => void = () => {}, reconnected: () => void = () => {};
  let hold = false, held: ((response: Response) => void) | undefined;
  const calls: Array<{ path: string; method: string }> = [];
  const socket = { connected: true, joinTicket: () => {}, leaveTicket: () => {}, onNewMessage: () => () => {},
    onCaseUpdated: (handler: (event: unknown) => void) => { changed = handler; return () => { changed = () => {}; }; },
    onConnected: (handler: () => void) => { reconnected = handler; return () => { reconnected = () => {}; }; } };
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname, method = init?.method ?? "GET"; calls.push({ path, method });
    if (method === "GET" && path.endsWith("/conversations")) return Response.json({ data: [{ ...detail.ticket, binding: detail.binding }], has_more: false, next_cursor: null });
    if (method === "GET" && path.endsWith("/ticket-a")) { if (hold) { hold = false; return new Promise(resolve => { held = resolve; }); } return Response.json(detail); }
    throw Error("unexpected_staff_alert_ui_request");
  } });
  function App() { vm = useWhatsAppConversations({ context, api, socket }); return <WhatsAppConversationDrawer context={context} api={api} vm={vm} />; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  cleanups.push(async () => { await act(async () => { root.unmount(); held?.(Response.json(detail)); }); host.remove(); });
  await act(async () => root.render(<App />)); await act(async () => vm.open("ticket-a"));
  return { detail, calls, async change(next: keyof typeof labels, reconnect = false) { detail.staffAlert = { status: next, revision: (detail.staffAlert?.revision ?? 0) + 1 }; await act(async () => { if (reconnect) reconnected(); else changed({ ticketId: "ticket-a" }); }); },
    async enter(value: string) { const field = document.querySelector("textarea")!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); },
    async background() { hold = true; await act(async () => changed({ ticketId: "ticket-a" })); },
    async switchScope() { context = { merchant_id: "merchant-b", user_id: "operator-b", role: "STAFF" }; await act(async () => root.render(<App />)); },
    async release() { await act(async () => { held?.(Response.json(detail)); held = undefined; }); } };
}
describe("T101 truthful private staff alert projection", () => {
  for (const status of Object.keys(labels) as Array<keyof typeof labels>) it(`${status} has its own staff label and preserves operator delivery`, async () => {
    const f = await fixture(status); expect(document.body.textContent).toContain(labels[status]); expect(document.querySelector('[data-delivery="delivered"]')).not.toBeNull();
    expect(f.calls.every(row => row.method === "GET" && row.path.includes("/conversations"))).toBe(true);
    expect(document.body.textContent).not.toContain("5511999999999"); expect(Array.from(document.querySelectorAll("button")).some(row => /reenviar alerta/i.test(row.textContent ?? ""))).toBe(false);
    if (status === "accepted") expect(document.body.textContent).not.toContain(labels.delivered);
    if (status === "unknown") expect(document.body.textContent).not.toContain(labels.failed);
  });
  it("a historical case without projection has no inferred delivery or availability claim", async () => {
    await fixture(); expect(document.body.textContent).not.toMatch(/Alerta à equipe|Falha no alerta|Envio do alerta/);
  });
  for (const reconnect of [false, true]) it(`${reconnect ? "reconnect" : "case_updated"} rereads status without clearing the unsent reply`, async () => {
    const f = await fixture("accepted"); await f.enter("Rascunho preservado"); const field = document.querySelector("textarea");
    await f.change("unknown", reconnect); expect(document.body.textContent).toContain(labels.unknown); expect(document.querySelector("textarea")).toBe(field);
    expect((field as HTMLTextAreaElement).value).toBe("Rascunho preservado"); expect(f.calls.every(row => row.method === "GET")).toBe(true);
  });
  it("a deferred old-scope alert cannot restore the old case or draft", async () => {
    const f = await fixture("accepted"); await f.enter("Rascunho do primeiro usuário"); await f.background(); await f.switchScope(); await f.release();
    expect(document.body.textContent).not.toContain("Rascunho do primeiro usuário"); expect(document.querySelector("textarea")).toBeNull();
  });
});
