/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDashboardApi } from "../../api-client.js";
import { ApiContext } from "../../hooks/useApi.js";
import { WhatsAppConversationsTab } from "./WhatsAppConversationsTab.js";
import type { ConversationContext } from "./conversation-types.js";

const port = vi.hoisted(() => ({ connected: true, scopes: [] as Array<string | undefined>, joinTicket: () => {}, leaveTicket: () => {},
  onNewMessage: () => () => {}, onCaseUpdated: () => () => {}, onConnected: () => () => {} }));
vi.mock("../../hooks/useSupportSocket.js", () => ({ useSupportSocket: (_base: string, merchantId: string | undefined) => { port.scopes.push(merchantId); return port; } }));
const mounts: Array<{ root: Root; host: HTMLElement }> = [];
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); port.connected = true; port.scopes.length = 0; });
afterEach(async () => { for (const item of mounts.splice(0)) { await act(async () => item.root.unmount()); item.host.remove(); } });
const principal: ConversationContext = { merchant_id: "merchant-a", user_id: "operator-a", role: "STAFF" };
const findButton = (text: string) => Array.from(document.querySelectorAll("button")).find(button => button.textContent?.trim() === text)!;
async function click(text: string) { await act(async () => findButton(text).click()); }
async function fixture(options: { empty?: boolean; failed?: boolean; held?: boolean; more?: boolean; owner?: boolean; mismatch?: boolean; missingOwnerId?: boolean } = {}) {
  const calls: Array<{ method: string; path: string }> = [], selected: string[] = [];
  let ticketId: string | null = null, closes = 0, release: (() => void) | undefined;
  const row = (id: string) => ({ id, status: "open", buyerMessage: "Cliente " + id, createdAt: "2026-11-19T10:00:00Z", updatedAt: "2026-11-19T10:00:00Z",
    binding: { id: "binding-" + id, ticketId: id, mode: "waiting_human", epoch: 1, assignedOperatorId: null } });
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET"; calls.push({ method, path: url.pathname + url.search });
    if (url.pathname.endsWith("/conversations/context")) return Response.json({ ...principal, merchant_id: options.mismatch ? "other-merchant" : principal.merchant_id, role: "OWNER" });
    if (url.pathname.endsWith("/conversations")) {
      if (options.held) await new Promise<void>(resolve => { release = resolve; });
      if (options.failed) return Response.json({ detail: "private_internal_failure" }, { status: 503 });
      return Response.json({ data: options.empty ? [] : [row(url.searchParams.has("cursor") ? "ticket-b" : "ticket-a")],
        has_more: Boolean(options.more && !url.searchParams.has("cursor")), next_cursor: options.more && !url.searchParams.has("cursor") ? "opaque-next-page" : null });
    }
    if (url.pathname.endsWith("/conversations/ticket-a")) return Response.json({ ticket: row("ticket-a"), binding: { ...row("ticket-a").binding, configId: "config-a", whatsappSessionId: "session-a" },
      channel: { id: "config-a", provider: "META_CLOUD", enabled: true, status: "ACTIVE" }, messages: [{ id: "message-a", ticketId: "ticket-a", senderType: "buyer", content: "Histórico autorizado", createdAt: "2026-11-19T10:00:00Z" }], has_more: false, next_cursor: null });
    throw Error("configuration_or_unexpected_request:" + method + url.pathname);
  } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  const render = () => root.render(<ApiContext.Provider value={api}><WhatsAppConversationsTab apiBaseUrl="https://api.example.test"
    {...(options.owner ? options.missingOwnerId ? {} : { expectedMerchantId: principal.merchant_id } : { context: principal })} ticketId={ticketId}
    onSelectTicket={id => selected.push(id)} onCloseTicket={() => { closes++; }} /></ApiContext.Provider>);
  await act(async () => render());
  return { calls, selected, get closes() { return closes; }, async route(id: string | null) { ticketId = id; await act(async () => render()); },
    async release() { options.held = false; await act(async () => release?.()); }, async render() { await act(async () => render()); } };
}

describe("T62 Conversations tab uses canonical reads and URL-owned selection", () => {
  it("shows the scoped queue for Staff without querying a private profile or configuration", async () => {
    const f = await fixture(); expect(document.body.textContent).toContain("Cliente ticket-a");
    expect(f.calls).toHaveLength(1); expect(f.calls[0]!.path).toContain("/support/whatsapp/conversations?");
    expect(f.calls.some(call => /merchants|settings|billing|templates/.test(call.path))).toBe(false);
  });
  it("row click only requests URL selection; its subsequent route reads detail exactly once", async () => {
    const f = await fixture(); await click("Abrir conversa");
    expect(f.selected).toEqual(["ticket-a"]); expect(f.calls.some(call => call.path.includes("/conversations/ticket-a"))).toBe(false);
    await f.route("ticket-a"); expect(document.body.textContent).toContain("Histórico autorizado");
    expect(f.calls.filter(call => call.path.includes("/conversations/ticket-a"))).toHaveLength(1);
    await f.render(); expect(f.calls.filter(call => call.path.includes("/conversations/ticket-a"))).toHaveLength(1);
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Fechar"]')!;
    await act(async () => close.click()); expect(f.closes).toBe(1);
    await f.route(null); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("shows pending loading separately from a confirmed empty queue", async () => {
    const f = await fixture({ empty: true, held: true });
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Carregando conversas");
    expect(document.body.textContent).not.toContain("Nenhuma conversa");
    await f.release(); expect(document.body.textContent).toContain("Nenhuma conversa");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  it("shows a readable read-error and retries only the requested read gesture", async () => {
    const f = await fixture({ failed: true });
    expect(document.querySelector('[role="alert"]')).not.toBeNull(); expect(document.body.textContent).not.toContain("private_internal_failure");
    await click("Tentar novamente"); expect(f.calls).toHaveLength(2); expect(f.calls.every(call => call.method === "GET")).toBe(true);
  });
  it("loads the next canonical cursor and retains the first page", async () => {
    const f = await fixture({ more: true }); await click("Carregar mais conversas");
    expect(document.body.textContent).toContain("Cliente ticket-a"); expect(document.body.textContent).toContain("Cliente ticket-b");
    expect(f.calls[1]!.path).toContain("cursor=opaque-next-page"); expect(f.calls.every(call => call.method === "GET")).toBe(true);
  });
  it("Owner context is read once from the canonical endpoint instead of deriving operator identity from the profile", async () => {
    const f = await fixture({ owner: true }); await f.render();
    expect(f.calls.filter(call => call.path.endsWith("/context"))).toHaveLength(1); expect(document.body.textContent).toContain("Cliente ticket-a");
  });
  it("a context from a different merchant cannot trigger a queue or expose its history", async () => {
    const f = await fixture({ owner: true, mismatch: true });
    expect(f.calls.filter(call => /\/conversations\?/.test(call.path))).toHaveLength(0);
    expect(document.querySelector('[role="alert"]')).not.toBeNull(); expect(document.body.textContent).not.toContain("Cliente ticket-a");
  });
  it("missing context and Owner merchant identity shows an access error without authorizing any read or socket scope", async () => {
    const f = await fixture({ owner: true, missingOwnerId: true });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("N\u00e3o foi poss\u00edvel verificar seu acesso ao atendimento.");
    expect(f.calls).toEqual([]); expect(port.scopes.filter(Boolean)).toEqual([]);
    expect(document.body.textContent).not.toContain("Cliente ticket-a");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});


describe("T62 readable queue presentation keeps selection and counts canonical", () => {
  it("identifies the selected request without inventing a contact name or losing its preview/date", async () => {
    const f = await fixture();
    const row = document.querySelector<HTMLLIElement>('[aria-label="Fila de conversas"] > li')!;
    expect(row.textContent).toContain("Conversa #CKET-A");
    expect(row.textContent).toContain("Cliente ticket-a");
    expect(row.querySelector("time")?.dateTime).toBe("2026-11-19T10:00:00Z");
    expect(row.getAttribute("aria-current")).toBeNull();
    await click("Abrir conversa");
    expect(f.selected).toEqual(["ticket-a"]);
    await f.route("ticket-a");
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(document.body.textContent).toContain("Histórico autorizado");
    await f.route(null);
    expect(row.getAttribute("aria-current")).toBeNull();
    expect(row.textContent).toContain("Cliente ticket-a");
  });
  it("describes only loaded conversations and updates that count after the real next-page gesture", async () => {
    const f = await fixture({ more: true });
    expect(document.body.textContent).toContain("1 conversa carregada");
    await click("Carregar mais conversas");
    expect(document.body.textContent).toContain("2 conversas carregadas");
    expect(document.querySelectorAll('[aria-label="Fila de conversas"] > li')).toHaveLength(2);
    expect(document.body.textContent).toContain("Cliente ticket-a");
    expect(document.body.textContent).toContain("Cliente ticket-b");
    expect(f.calls[1]!.path).toContain("cursor=opaque-next-page");
    expect(f.calls.every(call => call.method === "GET")).toBe(true);
  });
});
