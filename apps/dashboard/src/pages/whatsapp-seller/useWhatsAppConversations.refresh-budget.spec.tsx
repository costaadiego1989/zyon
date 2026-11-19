/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardApi } from "../../api-client.js";
import { useWhatsAppConversations } from "./useWhatsAppConversations.js";
import type { ConversationContext, ConversationDetail } from "./conversation-types.js";

const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function fixture() {
  let context: ConversationContext = { merchant_id: "merchant-a", user_id: "operator-a", role: "STAFF" };
  let serverTenant = "a", hold = false;
  let caseHandler: (value: unknown) => void = () => {};
  let connectedHandler: () => void = () => {};
  const waiting: Array<() => void> = [];
  const calls: Array<{ path: string; method: string; tenant: string }> = [];
  let concurrent = 0, maximumConcurrent = 0;
  function detail(tenant: string, closed = false): ConversationDetail {
    return { ticket: { id: "ticket-" + tenant, status: closed ? "closed" : "in_progress", buyerMessage: "Cliente " + tenant,
      createdAt: "2026-11-19T10:00:00Z", updatedAt: "2026-11-19T10:01:00Z" },
      binding: { id: "binding-" + tenant, ticketId: "ticket-" + tenant, mode: closed ? "ai" : "human", epoch: closed ? 3 : 2,
        assignedOperatorId: closed ? null : "operator-" + tenant, configId: "config-" + tenant, whatsappSessionId: "session-" + tenant },
      channel: { id: "config-" + tenant, provider: "META_CLOUD", enabled: true, status: "ACTIVE" },
      messages: [], has_more: false, next_cursor: null };
  }
  const stored: Record<string, ConversationDetail> = { a: detail("a"), b: detail("b") };
  const socket = { connected: true, joinTicket: () => {}, leaveTicket: () => {}, onNewMessage: () => () => {},
    onCaseUpdated: (fn: (value: unknown) => void) => { caseHandler = fn; return () => { if (caseHandler === fn) caseHandler = () => {}; }; },
    onConnected: (fn: () => void) => { connectedHandler = fn; return () => { if (connectedHandler === fn) connectedHandler = () => {}; }; } };
  const api = createDashboardApi({ baseUrl: "https://api.example.test", fetchImpl: async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET", tenant = serverTenant;
    calls.push({ path: url.pathname, method, tenant });
    if (method !== "GET") throw Error("refresh_must_never_submit_a_command");
    if (url.pathname.endsWith("/conversations")) {
      const value = structuredClone(stored[tenant]!);
      return Response.json({ data: [{ ...value.ticket, binding: value.binding }], has_more: false, next_cursor: null });
    }
    const match = /\/conversations\/ticket-([ab])$/.exec(url.pathname);
    if (!match) throw Error("unexpected_refresh_path");
    const value = structuredClone(stored[match[1]!]!);
    concurrent++; maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    try { if (hold && match[1] === "a") await new Promise<void>(resolve => waiting.push(resolve)); }
    finally { concurrent--; }
    return Response.json(value);
  } });
  let vm!: ReturnType<typeof useWhatsAppConversations>;
  function App() { vm = useWhatsAppConversations({ context, api, socket }); return <span>{vm.detail?.ticket.id}:{vm.detail?.ticket.status}</span>; }
  const host = document.createElement("div"); document.body.append(host);
  const root: Root = createRoot(host);
  const render = () => root.render(<App />);
  const release = async () => { hold = false; await act(async () => { for (const resolve of waiting.splice(0)) resolve(); }); await act(async () => {}); };
  cleanup.push(async () => { await release(); await act(async () => root.unmount()); host.remove(); });
  await act(async () => render());
  await act(async () => vm.open("ticket-a"));
  calls.length = 0; maximumConcurrent = 0;
  return { get vm() { return vm; }, calls, get maximumConcurrent() { return maximumConcurrent; },
    get detailReads() { return calls.filter(call => /\/ticket-[ab]$/.test(call.path)); },
    get queueReads() { return calls.filter(call => call.path.endsWith("/conversations")); },
    block() { hold = true; }, release,
    closeStored() { stored.a = detail("a", true); },
    async events(count: number) { await act(async () => { for (let i = 0; i < count; i++) caseHandler({ ticketId: "ticket-a", status: stored.a!.ticket.status }); }); },
    async reconnect() {
      await act(async () => { socket.connected = false; render(); });
      await act(async () => { socket.connected = true; connectedHandler(); render(); });
    },
    async switchTenant() {
      serverTenant = "b"; context = { merchant_id: "merchant-b", user_id: "operator-b", role: "STAFF" };
      await act(async () => render()); await act(async () => vm.open("ticket-b"));
    } };
}

describe("T61 refreshes preserve fresh state without multiplying equivalent reads", () => {
  it("coalesces a burst before reading and displays the authoritative final state", async () => {
    const f = await fixture(); f.closeStored(); await f.events(5);
    expect(f.detailReads).toHaveLength(1); expect(f.queueReads).toHaveLength(1);
    expect(f.vm.detail?.ticket.status).toBe("closed"); expect(f.vm.detail?.binding?.mode).toBe("ai");
    expect(f.vm.queue[0]?.status).toBe("closed"); expect(f.calls.every(call => call.method === "GET")).toBe(true);
  });
  it("serializes a final reread for changes received while the prior read is in flight", async () => {
    const f = await fixture(); f.block(); await f.events(1);
    f.closeStored(); await f.events(4);
    expect(f.maximumConcurrent).toBe(1);
    await f.release();
    expect(f.detailReads).toHaveLength(2); expect(f.queueReads).toHaveLength(2);
    expect(f.vm.detail?.ticket.status).toBe("closed"); expect(f.vm.detail?.binding?.epoch).toBe(3);
    expect(f.vm.queue[0]?.status).toBe("closed");
  });
  it("uses one refresh for the authenticated event and connected edge of the same reconnect", async () => {
    const f = await fixture(); await f.reconnect();
    expect(f.detailReads).toHaveLength(1); expect(f.queueReads).toHaveLength(1);
    expect(f.vm.detail?.ticket.id).toBe("ticket-a"); expect(f.vm.detail?.binding?.assignedOperatorId).toBe("operator-a");
    expect(f.calls.every(call => call.method === "GET")).toBe(true);
  });
  it("does not carry a queued old-tenant refresh into the new tenant", async () => {
    const f = await fixture(); f.block(); await f.events(1); await f.events(1);
    await f.switchTenant(); const count = f.calls.length;
    await f.release();
    expect(f.vm.scope).toBe(JSON.stringify(["merchant-b", "operator-b"]));
    expect(f.vm.detail?.ticket.id).toBe("ticket-b"); expect(f.vm.queue.map(row => row.id)).toEqual(["ticket-b"]);
    expect(f.calls.slice(count)).toEqual([]); expect(f.calls.every(call => call.method === "GET")).toBe(true);
  });
});
