/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWhatsAppConversations } from "./useWhatsAppConversations.js";
import type { ConversationApi, ConversationContext, ConversationDetail, ConversationMessage, ConversationPage } from "./conversation-types.js";

const context: ConversationContext = { merchant_id: "merchant-a", user_id: "operator-a", role: "STAFF" };
const detail: ConversationDetail = {
  ticket: { id: "ticket-a", status: "in_progress", buyerMessage: "Request", createdAt: "2026-11-18T10:00:00.000Z", updatedAt: "2026-11-18T10:00:00.000Z" },
  binding: { id: "binding-a", ticketId: "ticket-a", mode: "human", epoch: 2, assignedOperatorId: "operator-a", configId: "config-a", whatsappSessionId: "session-a" },
  channel: { id: "config-a", enabled: true, status: "ACTIVE", provider: "META_CLOUD" }, messages: [], has_more: false, next_cursor: null,
};
const page = (epoch = 2): ConversationPage => ({ data: [{ ...detail.ticket, binding: { ...detail.binding!, epoch } }], has_more: false, next_cursor: null });
const message = (revision = 0, status: "queued" | "accepted" | "read" = "queued"): ConversationMessage => ({ id: "message-a", ticketId: "ticket-a", senderType: "merchant", content: "Reply", createdAt: detail.ticket.createdAt, clientMessageId: "original_intent_123", delivery: { status, revision } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const value of mounts.splice(0)) { await act(async () => value.root.unmount()); value.host.remove(); } });
async function fixture(overrides: Partial<ConversationApi> = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let current: ConversationContext | null = context;
  let vm!: ReturnType<typeof useWhatsAppConversations>;
  let incoming: (raw: unknown) => void = () => {}, changed: (raw: unknown) => void = () => {}, authenticated: () => void = () => {};
  const socket = {
    connected: true, joinTicket: vi.fn(), leaveTicket: vi.fn(),
    onNewMessage: (handler: (raw: unknown) => void) => { incoming = handler; return () => { incoming = () => {}; }; },
    onCaseUpdated: (handler: (raw: unknown) => void) => { changed = handler; return () => { changed = () => {}; }; },
    onConnected: (handler: () => void) => { authenticated = handler; return () => { authenticated = () => {}; }; },
  };
  const api: ConversationApi = {
    getWhatsAppConversationContext: async () => context,
    getWhatsAppConversations: vi.fn(async () => page()), getWhatsAppConversation: vi.fn(async () => structuredClone(detail)),
    claimWhatsAppConversation: vi.fn(async () => ({})), closeWhatsAppConversation: vi.fn(async () => ({})),
    sendWhatsAppConversationMessage: vi.fn(async () => { throw Error("unknown response"); }), ...overrides,
  };
  function Probe() { vm = useWhatsAppConversations({ context: current, api, socket }); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(React.createElement(Probe)));
  return { api, socket, get vm() { return vm; }, get messageHandler() { return incoming; },
    async scope(value: ConversationContext | null) { current = value; await act(async () => root.render(React.createElement(Probe))); },
    async event(value: unknown) { await act(async () => incoming(value)); },
    async changed(value: unknown) { await act(async () => changed(value)); },
    async authenticated() { await act(async () => authenticated()); },
    async connection(value: boolean) { socket.connected = value; await act(async () => root.render(React.createElement(Probe))); },
  };
}

describe("T60 canonical queue lifecycle and command races", () => {
  it("loading resolves to a real empty queue without turning a failure into empty success", async () => {
    const held = deferred<ConversationPage>(), f = await fixture({ getWhatsAppConversations: () => held.promise });
    expect(f.vm.loading).toBe(true); expect(f.vm.error).toBeNull();
    await act(async () => held.resolve({ data: [], has_more: false, next_cursor: null }));
    expect(f.vm.loading).toBe(false); expect(f.vm.queue).toEqual([]); expect(f.vm.error).toBeNull();
  });
  it("failed refresh retains the last actual queue and exposes an error", async () => {
    let reads = 0;
    const f = await fixture({ getWhatsAppConversations: async () => { if (++reads > 1) throw Error("unavailable"); return page(); } });
    await act(async () => f.vm.reload());
    expect(f.vm.queue).toEqual(page().data); expect(f.vm.loading).toBe(false); expect(f.vm.error).not.toBeNull();
  });
  it("an older same-scope list response cannot overwrite a newer canonical owner/epoch", async () => {
    const old = deferred<ConversationPage>(); let reads = 0;
    const f = await fixture({ getWhatsAppConversations: () => ++reads === 1 ? old.promise : Promise.resolve(page(3)) });
    await act(async () => f.vm.reload());
    await act(async () => old.resolve(page(1)));
    expect(f.vm.queue).toEqual(page(3).data); expect(f.vm.loading).toBe(false);
  });
  it("logout fences a late detail response and an already queued old socket callback", async () => {
    const held = deferred<ConversationDetail>(), f = await fixture({ getWhatsAppConversation: () => held.promise });
    let pending!: Promise<void>; await act(async () => { pending = f.vm.open("ticket-a"); });
    const oldHandler = f.messageHandler; await f.scope(null);
    await act(async () => { oldHandler({ ...message(), metadata: { kind: "whatsapp_outgoing", schemaVersion: 1, clientMessageId: "original_intent_123", delivery: { status: "read", revision: 2 } } }); held.resolve(structuredClone(detail)); await pending; });
    expect(f.vm.detail).toBeNull(); expect(f.vm.queue).toEqual([]); expect(f.vm.detailError).toBeNull();
  });
  it("a delayed first selection cannot reopen over the currently selected conversation", async () => {
    const held = deferred<ConversationDetail>();
    const second = { ...structuredClone(detail), ticket: { ...detail.ticket, id: "ticket-b", buyerMessage: "Current B" }, binding: { ...detail.binding!, ticketId: "ticket-b" } };
    const f = await fixture({ getWhatsAppConversation: id => id === "ticket-a" ? held.promise : Promise.resolve(second) });
    let pending!: Promise<void>; await act(async () => { pending = f.vm.open("ticket-a"); });
    await act(async () => f.vm.open("ticket-b"));
    await act(async () => { held.resolve(structuredClone(detail)); await pending; });
    expect(f.vm.detail?.ticket.buyerMessage).toBe("Current B"); expect(f.vm.detail?.ticket.id).toBe("ticket-b");
  });
  it("closing a pending detail clears loading and a late response cannot reopen it", async () => {
    const held = deferred<ConversationDetail>(), f = await fixture({ getWhatsAppConversation: () => held.promise });
    let pending!: Promise<void>; await act(async () => { pending = f.vm.open("ticket-a"); });
    expect(f.vm.detailLoading).toBe(true); await act(async () => f.vm.closeDrawer());
    expect(f.vm.detail).toBeNull(); expect(f.vm.detailLoading).toBe(false);
    await act(async () => { held.resolve(structuredClone(detail)); await pending; });
    expect(f.vm.detail).toBeNull(); expect(f.vm.detailLoading).toBe(false);
  });
  it("older history pages add history without rolling back current binding or delivery revision", async () => {
    const current = { ...structuredClone(detail), binding: { ...detail.binding!, epoch: 3 }, messages: [message(7, "read")], has_more: true, next_cursor: "history-cursor" };
    const older = { ...structuredClone(detail), messages: [{ ...message(), id: "older", clientMessageId: "older_intent_123", createdAt: "2026-11-18T09:00:00.000Z" }, message()], has_more: false, next_cursor: null };
    const get = vi.fn(async (_id: string, query?: { cursor?: string }) => query?.cursor ? older : current);
    const f = await fixture({ getWhatsAppConversation: get }); await act(async () => f.vm.open("ticket-a"));
    await act(async () => f.vm.loadMoreMessages());
    expect(get.mock.calls[1]).toEqual(["ticket-a", { limit: 100, cursor: "history-cursor" }]);
    expect(f.vm.detail?.binding?.epoch).toBe(3); expect(f.vm.detail?.messages.map(row => row.id)).toEqual(["older", "message-a"]);
    expect(f.vm.detail?.messages[1]?.delivery).toEqual({ status: "read", revision: 7 }); expect(f.vm.detail?.next_cursor).toBeNull();
  });
  it("a socket receipt arriving during the first HTTP read is retained at its actual newer revision", async () => {
    const held = deferred<ConversationDetail>(), f = await fixture({ getWhatsAppConversation: () => held.promise });
    let pending!: Promise<void>; await act(async () => { pending = f.vm.open("ticket-a"); });
    await f.event({ ...message(), metadata: { kind: "whatsapp_outgoing", schemaVersion: 1, clientMessageId: "original_intent_123", delivery: { status: "accepted", revision: 1 } } });
    await act(async () => { held.resolve({ ...structuredClone(detail), messages: [message()] }); await pending; });
    expect(f.vm.detail?.messages).toEqual([message(1, "accepted")]);
  });
  it("claim conflict rereads the actual winner and keeps commands unavailable to this operator", async () => {
    let winner = false;
    const waiting = { ...structuredClone(detail), ticket: { ...detail.ticket, status: "open" as const }, binding: { ...detail.binding!, mode: "waiting_human" as const, epoch: 1, assignedOperatorId: null } };
    const owned = { ...structuredClone(detail), binding: { ...detail.binding!, assignedOperatorId: "other-operator" } };
    const claim = vi.fn(async () => { winner = true; throw Error("claim conflict"); });
    const f = await fixture({ getWhatsAppConversation: async () => winner ? owned : waiting, claimWhatsAppConversation: claim });
    await act(async () => f.vm.open("ticket-a")); await act(async () => { await expect(f.vm.claim()).rejects.toThrow("claim conflict"); });
    expect(f.vm.detail?.binding?.assignedOperatorId).toBe("other-operator"); expect(f.vm.actionError).not.toBeNull();
    await act(async () => { await expect(f.vm.claim()).rejects.toThrow("conversation_command_unavailable"); });
    expect(claim).toHaveBeenCalledTimes(1);
  });
  it("concurrent claim gestures dispatch once and show no invented ownership before the server read", async () => {
    const held = deferred<unknown>(); let won = false;
    const waiting = { ...structuredClone(detail), ticket: { ...detail.ticket, status: "open" as const }, binding: { ...detail.binding!, mode: "waiting_human" as const, epoch: 1, assignedOperatorId: null } };
    const claim = vi.fn(async () => { await held.promise; won = true; return {}; });
    const f = await fixture({ getWhatsAppConversation: async () => won ? structuredClone(detail) : waiting, claimWhatsAppConversation: claim });
    await act(async () => f.vm.open("ticket-a")); let pending!: Promise<void>;
    await act(async () => { pending = f.vm.claim(); });
    await act(async () => { await expect(f.vm.claim()).rejects.toThrow("conversation_command_unavailable"); });
    expect(claim).toHaveBeenCalledTimes(1); expect(f.vm.detail?.binding?.mode).toBe("waiting_human");
    await act(async () => { held.resolve({}); await pending; });
    expect(f.vm.detail?.binding?.mode).toBe("human"); expect(f.vm.busy).toBe(false);
  });
  it("authenticated reconnect and case_updated read canonical state without a send or claim replay", async () => {
    let epoch = 2;
    const f = await fixture({ getWhatsAppConversation: async () => ({ ...structuredClone(detail), binding: { ...detail.binding!, epoch } }), getWhatsAppConversations: async () => page(epoch) });
    await act(async () => f.vm.open("ticket-a")); epoch = 3; await f.authenticated();
    expect(f.vm.detail?.binding?.epoch).toBe(3); expect(f.vm.queue[0]?.binding?.epoch).toBe(3);
    epoch = 4; await f.changed({ ticketId: "ticket-a" }); expect(f.vm.detail?.binding?.epoch).toBe(4);
    expect(f.api.sendWhatsAppConversationMessage).not.toHaveBeenCalled(); expect(f.api.claimWhatsAppConversation).not.toHaveBeenCalled();
  });
  it("an acknowledged older action cannot hijack a newer selected conversation", async () => {
    const held = deferred<ConversationMessage>();
    const second = { ...structuredClone(detail), ticket: { ...detail.ticket, id: "ticket-b" }, binding: { ...detail.binding!, ticketId: "ticket-b" } };
    const send = vi.fn((_id: string, _body: { content: string; clientMessageId: string }) => held.promise);
    const f = await fixture({ getWhatsAppConversation: async id => id === "ticket-b" ? second : structuredClone(detail), sendWhatsAppConversationMessage: send });
    await act(async () => f.vm.open("ticket-a")); let pending!: Promise<void>; await act(async () => { pending = f.vm.send("Reply"); });
    await act(async () => f.vm.open("ticket-b"));
    await act(async () => { held.resolve({ ...message(), clientMessageId: send.mock.calls[0]![1].clientMessageId }); await pending; });
    expect(f.vm.detail?.ticket.id).toBe("ticket-b"); expect(f.vm.detail?.messages).toEqual([]); expect(f.vm.actionError).toBeNull();
  });
  it("offline blocks a reply and an unknown response never adds an optimistic delivered/read message", async () => {
    const f = await fixture(); await act(async () => f.vm.open("ticket-a")); await f.connection(false);
    await act(async () => { await expect(f.vm.send("Reply")).rejects.toThrow("conversation_command_unavailable"); });
    expect(f.api.sendWhatsAppConversationMessage).not.toHaveBeenCalled(); await f.connection(true);
    await act(async () => { await expect(f.vm.send("Reply")).rejects.toThrow("unknown response"); });
    expect(f.vm.detail?.messages).toEqual([]); expect(f.vm.actionError).not.toBeNull();
  });
});
