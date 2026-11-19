/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSupportSocket } from "./useSupportSocket.js";
import { useWhatsAppConversations } from "../pages/whatsapp-seller/useWhatsAppConversations.js";
import type { ConversationApi, ConversationDetail } from "../pages/whatsapp-seller/conversation-types.js";

const transport = vi.hoisted(() => {
  const instances: Array<{
    emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn>; server: (event: string, payload?: unknown) => void;
  }> = [];
  const io = vi.fn(() => {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const server = (event: string, payload?: unknown) => { for (const handler of [...(listeners.get(event) ?? [])]) handler(payload); };
    const socket = {
      emit: vi.fn(), disconnect: vi.fn(() => server("disconnect")), server,
      on: vi.fn((event: string, handler: (payload: unknown) => void) => { const group = listeners.get(event) ?? new Set(); group.add(handler); listeners.set(event, group); }),
      off: vi.fn((event: string, handler: (payload: unknown) => void) => { listeners.get(event)?.delete(handler); }),
    };
    instances.push(socket); return socket;
  });
  return { io, instances };
});
vi.mock("socket.io-client", () => ({ io: transport.io }));
const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => { for (const value of mounts.splice(0)) { await act(async () => value.root.unmount()); value.host.remove(); } transport.instances.length = 0; transport.io.mockClear(); });
async function fixture() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let merchant: string | undefined = "merchant-a";
  let vm!: ReturnType<typeof useSupportSocket>;
  function Probe() { vm = useSupportSocket("https://api.example.test", merchant); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(React.createElement(Probe)));
  return { get vm() { return vm; }, async scope(value: string | undefined) { merchant = value; await act(async () => root.render(React.createElement(Probe))); } };
}

describe("T60 existing support socket conversation subscriptions", () => {
  it("a nested conversation hook subscribes when its parent socket authenticates after mounting", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const context = { merchant_id: "merchant-a", user_id: "operator-a", role: "STAFF" as const };
    const detail: ConversationDetail = {
      ticket: { id: "ticket-a", status: "in_progress", buyerMessage: "Request", createdAt: "2026-11-18T10:00:00.000Z", updatedAt: "2026-11-18T10:00:00.000Z" },
      binding: { id: "binding-a", ticketId: "ticket-a", mode: "human", epoch: 2, assignedOperatorId: "operator-a", configId: "config-a", whatsappSessionId: "session-a" },
      channel: { id: "config-a", provider: "META_CLOUD", enabled: true, status: "ACTIVE" }, messages: [], has_more: false, next_cursor: null,
    };
    const api: ConversationApi = {
      getWhatsAppConversationContext: async () => context,
      getWhatsAppConversations: async () => ({ data: [], has_more: false, next_cursor: null }),
      getWhatsAppConversation: async () => structuredClone(detail), claimWhatsAppConversation: async () => ({}), closeWhatsAppConversation: async () => ({}),
      sendWhatsAppConversationMessage: async () => { throw Error("no automatic send"); },
    };
    let vm!: ReturnType<typeof useWhatsAppConversations>;
    function Child({ socket }: { socket: ReturnType<typeof useSupportSocket> }) { vm = useWhatsAppConversations({ context, api, socket }); return null; }
    function Parent() { const socket = useSupportSocket("https://api.example.test", context.merchant_id); return React.createElement(Child, { socket }); }
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
    await act(async () => root.render(React.createElement(Parent)));
    await act(async () => vm.open("ticket-a"));
    const socket = transport.instances[0]!;
    await act(async () => socket.server("authenticated", { role: "merchant" }));
    await act(async () => socket.server("new_message", { id: "incoming-a", ticketId: "ticket-a", senderType: "buyer", content: "Actual current message", createdAt: detail.ticket.createdAt }));
    expect(vm.detail?.messages).toEqual([{ id: "incoming-a", ticketId: "ticket-a", senderType: "buyer", content: "Actual current message", createdAt: detail.ticket.createdAt }]);
    expect(socket.emit.mock.calls.some(call => call[0] === "send_message")).toBe(false);
  });
  it("subscribes to the publisher's actual case_updated frame and unsubscribes cleanly", async () => {
    const f = await fixture(), handler = vi.fn();
    const unsubscribe = f.vm.onCaseUpdated(handler), socket = transport.instances[0]!;
    await act(async () => socket.server("case_updated", { ticketId: "ticket-a", status: "closed" }));
    expect(handler).toHaveBeenCalledWith({ ticketId: "ticket-a", status: "closed" });
    unsubscribe(); await act(async () => socket.server("case_updated", { ticketId: "ticket-a" }));
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("authenticated reconnect rejoins rooms and notifies read subscribers without sending a reply", async () => {
    const f = await fixture(), socket = transport.instances[0]!, restored = vi.fn();
    f.vm.joinTicket("ticket-a"); const unsubscribe = f.vm.onConnected(restored);
    await act(async () => socket.server("authenticated", { role: "merchant" }));
    await act(async () => socket.server("disconnect"));
    await act(async () => socket.server("authenticated", { role: "merchant" }));
    expect(f.vm.connected).toBe(true); expect(restored).toHaveBeenCalledTimes(2);
    expect(socket.emit.mock.calls.filter(call => call[0] === "join_merchant")).toEqual([["join_merchant", { merchantId: "merchant-a" }], ["join_merchant", { merchantId: "merchant-a" }]]);
    expect(socket.emit.mock.calls.some(call => call[0] === "send_message")).toBe(false); unsubscribe();
  });
  it("scope replacement clears prior merchant state and ignores already queued old socket callbacks", async () => {
    const f = await fixture(), old = transport.instances[0]!;
    await act(async () => { old.server("authenticated"); old.server("new_ticket", { id: "private-a", buyerMessage: "Private merchant A" }); });
    expect(f.vm.newTickets).toHaveLength(1); expect(f.vm.connected).toBe(true);
    await f.scope("merchant-b"); expect(f.vm.connected).toBe(false); expect(f.vm.newTickets).toEqual([]);
    await act(async () => old.server("new_ticket", { id: "late-a", buyerMessage: "Late private A" }));
    expect(f.vm.newTickets).toEqual([]); expect(old.disconnect).toHaveBeenCalledTimes(1);
    await f.scope(undefined); expect(f.vm.connected).toBe(false); expect(f.vm.newTickets).toEqual([]);
  });
});
