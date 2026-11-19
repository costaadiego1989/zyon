/** @vitest-environment jsdom */
import React, { act } from "react";
import { randomUUID } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWhatsAppConversations } from "./useWhatsAppConversations.js";
import { whatsappConversationEndpoints } from "../../api/endpoints/whatsapp-conversations.js";
import type { ConversationDetail, ConversationDeliveryStatus, ConversationMessage } from "./conversation-types.js";

const mounts: Array<{ root: Root; host: HTMLDivElement }> = [];
beforeEach(() => { vi.stubGlobal("crypto", { randomUUID }); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(async () => { for (const value of mounts.splice(0)) { await act(async () => value.root.unmount()); value.host.remove(); } vi.unstubAllGlobals(); });

/** Actual hook + actual SDK/HTTP decoder. Only the transport is synthetic;
 * every tested POST resolves HTTP200 with its persisted public projection. */
async function fixture(initial: "queued" | "unknown") {
  const context = { merchant_id: "merchant-a", user_id: "operator-a", role: "STAFF" as const };
  const base: ConversationDetail = {
    ticket: { id: "ticket-a", status: "in_progress", buyerMessage: "Request", createdAt: "2026-11-18T10:00:00.000Z", updatedAt: "2026-11-18T10:00:00.000Z" },
    binding: { id: "binding-a", ticketId: "ticket-a", mode: "human", epoch: 2, assignedOperatorId: "operator-a", configId: "config-a", whatsappSessionId: "session-a" },
    channel: { id: "config-a", enabled: true, status: "ACTIVE", provider: "META_CLOUD" }, messages: [], has_more: false, next_cursor: null,
  };
  const rows = new Map<string, ConversationMessage>();
  const posts: Array<{ content: string; clientMessageId: string }> = [];
  const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const transport: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname, method = init?.method ?? "GET";
    if (method === "POST" && path === "/v1/support/whatsapp/conversations/ticket-a/messages") {
      const body = JSON.parse(String(init?.body)) as { content: string; clientMessageId: string };
      posts.push(structuredClone(body));
      let row = rows.get(body.clientMessageId);
      if (!row) {
        row = { id: "message-" + body.clientMessageId, ticketId: "ticket-a", senderType: "merchant", content: body.content,
          createdAt: base.ticket.createdAt, clientMessageId: body.clientMessageId, delivery: { status: initial, revision: initial === "queued" ? 0 : 1 } };
        rows.set(body.clientMessageId, row);
      }
      return response(row);
    }
    if (method === "GET" && path === "/v1/support/whatsapp/conversations/context") return response(context);
    if (method === "GET" && path === "/v1/support/whatsapp/conversations") return response({ data: [{ ...base.ticket, binding: base.binding }], has_more: false, next_cursor: null });
    if (method === "GET" && path === "/v1/support/whatsapp/conversations/ticket-a") return response({ ...base, messages: [...rows.values()] });
    throw Error("unexpected_synthetic_http_path");
  };
  const api = whatsappConversationEndpoints("https://api.example.test", transport);
  let incoming: (value: unknown) => void = () => {}, authenticated: () => void = () => {};
  const socket = { connected: true, joinTicket: vi.fn(), leaveTicket: vi.fn(),
    onNewMessage: (handler: (value: unknown) => void) => { incoming = handler; return () => { incoming = () => {}; }; },
    onConnected: (handler: () => void) => { authenticated = handler; return () => { authenticated = () => {}; }; } };
  let vm!: ReturnType<typeof useWhatsAppConversations>;
  function Probe() { vm = useWhatsAppConversations({ context, api, socket }); return null; }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); mounts.push({ root, host });
  await act(async () => root.render(React.createElement(Probe))); await act(async () => vm.open("ticket-a"));
  return { posts, rows, get vm() { return vm; },
    async reconnect() {
      socket.connected = false; await act(async () => root.render(React.createElement(Probe)));
      socket.connected = true; await act(async () => root.render(React.createElement(Probe)));
      await act(async () => authenticated());
    },
    async fact(status: "delivered" | "read") {
      const original = rows.get(posts[0]!.clientMessageId)!;
      const row = { ...original, delivery: { status: status as ConversationDeliveryStatus, revision: original.delivery!.revision + 1 } };
      rows.set(original.clientMessageId!, row);
      await act(async () => incoming({ ...row, metadata: { kind: "whatsapp_outgoing", schemaVersion: 1, clientMessageId: row.clientMessageId, delivery: row.delivery } }));
    },
    async resolvedSubmission(status: "accepted" | "failed") {
      const original = rows.get(posts[0]!.clientMessageId)!;
      rows.set(original.clientMessageId!, { ...original, delivery: { status, revision: original.delivery!.revision + 1 } });
      await act(async () => vm.open("ticket-a"));
    },
  };
}

describe("T60 unresolved successful HTTP replies retain the original client intent", () => {
  it("HTTP200 unknown and reconnect never turn a manual same-intent retry into a second submission", async () => {
    const f = await fixture("unknown"); await act(async () => f.vm.send("Original reply"));
    expect(f.vm.detail?.messages[0]?.delivery).toEqual({ status: "unknown", revision: 1 });
    const original = f.posts[0]!.clientMessageId;
    await f.reconnect(); expect(f.posts).toHaveLength(1);
    await act(async () => f.vm.send("Original reply"));
    expect(f.posts.map(body => body.clientMessageId)).toEqual([original, original]);
    expect(f.rows.size).toBe(1); expect(f.vm.detail?.messages).toHaveLength(1);
    expect(f.vm.detail?.messages[0]?.delivery?.status).toBe("unknown");
  });
  it("HTTP200 queued is still the same pending intent on an explicit retry", async () => {
    const f = await fixture("queued"); await act(async () => f.vm.send("Pending reply"));
    const original = f.posts[0]!.clientMessageId;
    expect(f.vm.detail?.messages[0]?.delivery).toEqual({ status: "queued", revision: 0 });
    await f.reconnect(); expect(f.posts).toHaveLength(1);
    await act(async () => f.vm.send("Pending reply"));
    expect(f.posts.map(body => body.clientMessageId)).toEqual([original, original]); expect(f.rows.size).toBe(1);
  });
  it("an actual delivered/read fact permits a later intentional new reply without replaying automatically", async () => {
    for (const status of ["delivered", "read"] as const) {
      const f = await fixture("unknown"); await act(async () => f.vm.send("Intentional reply"));
      const original = f.posts[0]!.clientMessageId; await f.fact(status);
      expect(f.vm.detail?.messages.find(row => row.clientMessageId === original)?.delivery?.status).toBe(status);
      await f.reconnect(); expect(f.posts).toHaveLength(1);
      await act(async () => f.vm.send("Intentional reply"));
      expect(f.posts).toHaveLength(2); expect(f.posts[1]!.clientMessageId).not.toBe(original); expect(f.rows.size).toBe(2);
    }
  });
  it("accepted or definitively failed submission permits a new intent while keeping its actual UI status", async () => {
    for (const status of ["accepted", "failed"] as const) {
      const f = await fixture("queued"); await act(async () => f.vm.send("Repeated intentional reply"));
      const original = f.posts[0]!.clientMessageId; await f.resolvedSubmission(status);
      expect(f.vm.detail?.messages.find(row => row.clientMessageId === original)?.delivery?.status).toBe(status);
      expect(f.vm.detail?.messages.find(row => row.clientMessageId === original)?.delivery?.status).not.toBe("read");
      await f.reconnect(); expect(f.posts).toHaveLength(1);
      await act(async () => f.vm.send("Repeated intentional reply"));
      expect(f.posts).toHaveLength(2); expect(f.posts[1]!.clientMessageId).not.toBe(original); expect(f.rows.size).toBe(2);
      expect(f.vm.detail?.messages.find(row => row.clientMessageId === original)?.delivery?.status).toBe(status);
    }
  });
});
