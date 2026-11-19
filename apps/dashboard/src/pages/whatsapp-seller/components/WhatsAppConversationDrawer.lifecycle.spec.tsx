/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDashboardApi } from "../../../api-client.js";
import { useWhatsAppConversations } from "../useWhatsAppConversations.js";
import { WhatsAppConversationDrawer } from "./WhatsAppConversationDrawer.js";
import type { ConversationContext, ConversationDetail, ConversationMessage } from "../conversation-types.js";

const context: ConversationContext = { merchant_id: "merchant-a", user_id: "operator-a", role: "STAFF" };
const mounts: Array<{ root: Root; host: HTMLElement }> = [];
beforeEach(() => { vi.stubGlobal("crypto", { randomUUID }); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(async () => { for (const item of mounts.splice(0)) { await act(async () => item.root.unmount()); item.host.remove(); } vi.unstubAllGlobals(); });
const button = (text: string) => [...document.querySelectorAll("button")].find(el => el.textContent?.trim() === text)!;
async function click(text: string) { await act(async () => button(text).click()); }
async function enter(value: string) {
  const input = document.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function fixture(options: { status?: "queued" | "unknown" | "failed"; failedHttp?: boolean; oldEqualText?: string; more?: boolean; otherOperator?: boolean; waiting?: boolean } = {}) {
  const messages: ConversationMessage[] = options.oldEqualText ? [{ id: "older-same-text", ticketId: "ticket-a", senderType: "merchant", content: options.oldEqualText, clientMessageId: "older-intent", createdAt: "2026-11-18T10:00:00Z", delivery: { status: "accepted", revision: 1 } }] : [];
  const detail: ConversationDetail = { ticket: { id: "ticket-a", status: "in_progress", buyerMessage: "Mensagem inicial", createdAt: "2026-11-18T10:00:00Z", updatedAt: "2026-11-18T10:00:00Z" },
    binding: { id: "binding-a", ticketId: "ticket-a", mode: "human", epoch: 2, assignedOperatorId: options.otherOperator ? "other-operator" : "operator-a", configId: "config-a", whatsappSessionId: "session-a" },
    channel: { id: "config-a", provider: "META_CLOUD", enabled: true, status: "ACTIVE" }, messages, has_more: options.more ?? false, next_cursor: options.more ? "opaque-history-cursor" : null };
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = [];
  if (options.waiting) { detail.ticket.status = "open"; detail.binding!.mode = "waiting_human"; detail.binding!.assignedOperatorId = null; }
  let failRead = false;
  let incoming: (value: unknown) => void = () => {}, vm!: ReturnType<typeof useWhatsAppConversations>;
  const socket = { connected: true, joinTicket: vi.fn(), leaveTicket: vi.fn(), onNewMessage: (fn: (value: unknown) => void) => { incoming = fn; return () => {}; } };
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: async (input, init) => {
    const url = new URL(String(input)), path = url.pathname, method = init?.method ?? "GET", body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ path: path + url.search, method, body });
    if (method === "POST" && /\/(claim|close)$/.test(path)) {
      expect(body.expectedEpoch).toBe(detail.binding!.epoch);
      if (path.endsWith("/claim")) { detail.ticket.status = "in_progress"; detail.binding!.mode = "human"; detail.binding!.assignedOperatorId = "operator-a"; }
      else { detail.ticket.status = "closed"; detail.binding!.mode = "ai"; detail.binding!.assignedOperatorId = null; }
      detail.binding!.epoch++; return Response.json(detail.binding);
    }
    if (method === "POST" && path.endsWith("/messages")) {
      if (options.failedHttp) return Response.json({ detail: "local_unavailable" }, { status: 503 });
      const previous = messages.find(row => row.clientMessageId === body.clientMessageId);
      const row: ConversationMessage = previous ?? { id: "reply-" + messages.length, ticketId: "ticket-a", senderType: "merchant", content: body.content, clientMessageId: body.clientMessageId, createdAt: "2026-11-18T11:00:00Z", delivery: { status: options.status ?? "unknown", revision: 1 } };
      if (!previous) messages.push(row); return Response.json(row);
    }
    if (method === "GET" && path.endsWith("/ticket-a")) {
      if (failRead) { failRead = false; return Response.json({ detail: "local_read_failed" }, { status: 503 }); }
      if (url.searchParams.has("cursor")) return Response.json({ ...detail, messages: [{ id: "older-buyer", ticketId: "ticket-a", senderType: "buyer", content: "Histórico anterior", createdAt: "2026-11-17T10:00:00Z" }], has_more: false, next_cursor: null });
      return Response.json(detail);
    }
    if (method === "GET" && path.endsWith("/conversations")) return Response.json({ data: [{ ...detail.ticket, binding: detail.binding }], has_more: false, next_cursor: null });
    throw Error("unexpected_test_request:" + method + path);
  } });
  function App() { vm = useWhatsAppConversations({ context, api, socket }); return <WhatsAppConversationDrawer context={context} api={api} vm={vm} />; }
  const host = document.createElement("div"), trigger = document.createElement("button"); trigger.textContent = "Abrir conversa"; host.append(trigger); document.body.append(host); trigger.focus();
  const root = createRoot(host.appendChild(document.createElement("div"))); mounts.push({ root, host });
  await act(async () => root.render(<App />)); await act(async () => vm.open("ticket-a"));
  return { get vm() { return vm; }, requests, messages, trigger, failNextRead: () => { failRead = true; },
    async fact(status: "accepted" | "delivered" | "read" | "failed") {
      const row = messages[messages.length - 1]!; row.delivery = { status, revision: row.delivery!.revision + 1 };
      await act(async () => incoming({ ...row, metadata: { kind: "whatsapp_outgoing", schemaVersion: 1, clientMessageId: row.clientMessageId, delivery: row.delivery } }));
    } };
}

describe("T61 canonical conversation gestures and draft correlation", () => {
  it("the send result exposes the exact canonical ticket/client intent for UI correlation", async () => {
    const f = await fixture(); let result: unknown;
    await act(async () => { result = await f.vm.send("Correlacionar resposta"); });
    expect(result).toMatchObject({ ticketId: "ticket-a", clientMessageId: f.messages[0]!.clientMessageId, content: "Correlacionar resposta", delivery: { status: "unknown", revision: 1 } });
  });
  it("HTTP200 unknown keeps the draft and does not mistake an older equal-text accepted message for its confirmation", async () => {
    const f = await fixture({ oldEqualText: "Mesmo texto" }); await enter("Mesmo texto"); await click("Enviar resposta");
    expect(document.querySelector("textarea")!.value).toBe("Mesmo texto"); expect(document.body.textContent).toContain("Envio não confirmado");
    expect(f.requests.filter(row => row.method === "POST")).toHaveLength(1); expect(document.querySelectorAll(".support-msg")).toHaveLength(2);
    await f.fact("read"); expect(document.querySelector("textarea")!.value).toBe("");
  });
  it("queued remains a draft until the same intent is accepted, without displaying it as read", async () => {
    const f = await fixture({ status: "queued" }); await enter("Responder agora"); await click("Enviar resposta");
    expect(document.querySelector("textarea")!.value).toBe("Responder agora"); expect(document.body.textContent).toContain("Na fila");
    await f.fact("accepted"); expect(document.querySelector("textarea")!.value).toBe(""); expect(document.body.textContent).toContain("Aceita pelo canal");
    expect(document.body.textContent).not.toContain("Lida"); expect(f.requests.filter(row => row.method === "POST")).toHaveLength(1);
  });
  it("a late confirmation does not erase a newer draft", async () => {
    const f = await fixture(); await enter("Primeira resposta"); await click("Enviar resposta"); await enter("Nova resposta em edição"); await f.fact("delivered");
    expect(document.querySelector("textarea")!.value).toBe("Nova resposta em edição"); expect(document.body.textContent).toContain("Entregue");
  });
  it("a definitively failed submission keeps its editable draft and truthful label", async () => {
    const f = await fixture({ status: "failed" }); await enter("Corrigir e reenviar"); await click("Enviar resposta");
    expect(document.querySelector("textarea")!.value).toBe("Corrigir e reenviar"); expect(document.body.textContent).toContain("Falhou"); expect(f.requests.filter(row => row.method === "POST")).toHaveLength(1);
  });
  it("HTTP failure preserves the draft and shows no optimistic merchant row", async () => {
    const f = await fixture({ failedHttp: true }); await enter("Não perder este texto"); await click("Enviar resposta");
    expect(document.querySelector("textarea")!.value).toBe("Não perder este texto"); expect(document.querySelectorAll(".support-msg")).toHaveLength(0); expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(f.requests.filter(row => row.method === "POST")).toHaveLength(1);
  });
  it("loads more history by the canonical cursor without repeating the initial buyer text", async () => {
    const f = await fixture({ more: true }); await click("Carregar mais mensagens");
    expect(document.body.textContent).toContain("Histórico anterior"); expect(document.body.textContent).not.toContain("Mensagem inicial");
    expect(f.requests.some(row => row.path.includes("cursor=opaque-history-cursor"))).toBe(true); expect(f.requests.filter(row => row.method === "POST")).toHaveLength(0);
  });
  it("another operator remains read-only in the actual mounted composition", async () => {
    const f = await fixture({ otherOperator: true }); expect(document.body.textContent).toContain("outro operador");
    expect(button("Enviar resposta").disabled).toBe(true); expect(button("Encerrar e retomar IA")).toBeUndefined(); expect(f.requests.filter(row => row.method === "POST")).toHaveLength(0);
  });
  it("Escape protects the unsent draft, Continue restores editing, and explicit discard restores trigger focus", async () => {
    const f = await fixture(); await enter("Ainda em edição");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.body.textContent).toContain("Continuar editando"); await click("Continuar editando"); expect(document.querySelector("textarea")!.value).toBe("Ainda em edição");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await click("Descartar e fechar");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(f.trigger);
  });
  it("claims through the canonical epoch and asks before ending a case with an unsent draft", async () => {
    const f = await fixture({ waiting: true }); expect(button("Enviar resposta").disabled).toBe(true); await click("Assumir atendimento");
    expect(f.requests.find(row => row.path.endsWith("/claim"))?.body).toEqual({ expectedEpoch: 2 }); expect(document.body.textContent).toContain("Atendimento humano com você");
    await enter("Resposta ainda não enviada"); await click("Encerrar e retomar IA");
    expect(f.requests.some(row => row.path.endsWith("/close"))).toBe(false); expect(document.body.textContent).toContain("Encerrar sem enviar"); await click("Encerrar sem enviar");
    expect(f.requests.find(row => row.path.endsWith("/close"))?.body).toEqual({ expectedEpoch: 3 }); expect(document.body.textContent).toContain("IA ativa"); expect(document.querySelector("textarea")).toBeNull();
  });
  it("keeps canonical history through a failed refresh and retries only the read gesture", async () => {
    const f = await fixture({ oldEqualText: "Histórico preservado" }); f.failNextRead(); await act(async () => f.vm.open("ticket-a"));
    expect(document.body.textContent).toContain("Histórico preservado"); expect(document.querySelector('[role="alert"]')).not.toBeNull(); expect(button("Enviar resposta").disabled).toBe(true);
    await click("Recarregar histórico"); expect(f.vm.detailError).toBeNull(); expect(document.body.textContent).toContain("Histórico preservado"); expect(f.requests.filter(row => row.method === "POST")).toHaveLength(0);
  });
});
