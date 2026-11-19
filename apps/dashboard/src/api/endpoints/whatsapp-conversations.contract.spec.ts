import { describe, expect, it } from "vitest";
import { whatsappConversationEndpoints } from "./whatsapp-conversations.js";

describe("T60 scoped conversation HTTP contract", () => {
  it("reads context and queue without a body or caller-selected merchant/profile/configuration", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const api = whatsappConversationEndpoints("https://api.example.test", async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body });
      return new Response(JSON.stringify({ data: [], has_more: false, next_cursor: null }), { status: 200 });
    });
    await api.getWhatsAppConversationContext();
    await api.getWhatsAppConversations({ limit: 25, cursor: "opaque-cursor", status: "open" });
    expect(calls.map(call => call.url)).toEqual([
      "https://api.example.test/v1/support/whatsapp/conversations/context",
      "https://api.example.test/v1/support/whatsapp/conversations?limit=25&cursor=opaque-cursor&status=open",
    ]);
    expect(calls.every(call => call.method === "GET" && (call.body === null || call.body === undefined))).toBe(true);
    expect(calls.some(call => /merchant|profile|configId|credentials/.test(new URL(call.url).search))).toBe(false);
  });

  it("escapes the ticket and preserves the opaque history cursor", async () => {
    let url = "";
    const api = whatsappConversationEndpoints("https://api.example.test/v1/", async input => {
      url = String(input); return new Response("{}", { status: 200 });
    });
    await api.getWhatsAppConversation("ticket/a", { limit: 100, cursor: "opaque+/=" });
    const request = new URL(url);
    expect(request.pathname).toBe("/v1/support/whatsapp/conversations/ticket%2Fa");
    expect([...request.searchParams]).toEqual([["limit", "100"], ["cursor", "opaque+/="]]);
  });

  it("commands preserve the server epoch and one explicit client intent without identity flags", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const api = whatsappConversationEndpoints("https://api.example.test", async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    });
    await api.claimWhatsAppConversation("ticket/a", { expectedEpoch: 1 });
    await api.closeWhatsAppConversation("ticket/a", { expectedEpoch: 2 });
    await api.sendWhatsAppConversationMessage("ticket/a", { content: "Canonical reply", clientMessageId: "original_intent_123" });
    expect(calls.map(call => call.url.split("/conversations/")[1])).toEqual(["ticket%2Fa/claim", "ticket%2Fa/close", "ticket%2Fa/messages"]);
    expect(calls.map(call => call.body)).toEqual([{ expectedEpoch: 1 }, { expectedEpoch: 2 }, { content: "Canonical reply", clientMessageId: "original_intent_123" }]);
  });

  it("an unavailable read rejects instead of manufacturing an empty successful queue", async () => {
    const api = whatsappConversationEndpoints("https://api.example.test", async () => new Response('{"message":"Unavailable"}', { status: 503 }));
    await expect(api.getWhatsAppConversations()).rejects.toMatchObject({ status: 503 });
  });
});
