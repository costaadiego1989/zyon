import { describe, expect, it } from "vitest";
import { conversationActions } from "./conversation-actions.js";
import type { ConversationContext, ConversationDetail } from "./conversation-types.js";

const context: ConversationContext = { merchant_id: "merchant-a", user_id: "operator-a", role: "STAFF" };
const detail: ConversationDetail = {
  ticket: { id: "ticket-a", status: "in_progress", buyerMessage: "Request", createdAt: "2026-11-18T10:00:00Z", updatedAt: "2026-11-18T10:00:00Z" },
  binding: { id: "binding-a", ticketId: "ticket-a", mode: "human", epoch: 2, assignedOperatorId: "operator-a", configId: "config-a", whatsappSessionId: "session-a" },
  channel: { id: "config-a", provider: "META_CLOUD", enabled: true, status: "ACTIVE" }, messages: [], has_more: false, next_cursor: null,
};

describe("T60 command guards explain canonical authority", () => {
  it("only the assigned operator may send or close; an owner cannot override another actor", () => {
    expect(conversationActions(context, detail, true)).toEqual({ claim: false, send: true, close: true });
    expect(conversationActions({ ...context, user_id: "other", role: "OWNER" }, detail, true)).toEqual({ claim: false, send: false, close: false });
  });
  it("offline cannot become sent while canonical close remains available", () => {
    expect(conversationActions(context, detail, false)).toEqual({ claim: false, send: false, close: true });
    expect(conversationActions(context, { ...detail, channel: null }, true)).toEqual({ claim: false, send: false, close: true });
  });
  it("missing/mismatched bindings and terminal cases do not acquire a command grant", () => {
    const none = { claim: false, send: false, close: false };
    expect(conversationActions(context, { ...detail, binding: null }, true)).toEqual(none);
    expect(conversationActions(context, { ...detail, binding: { ...detail.binding!, ticketId: "foreign" } }, true)).toEqual(none);
    expect(conversationActions(context, { ...detail, ticket: { ...detail.ticket, status: "closed" }, binding: { ...detail.binding!, mode: "ai", assignedOperatorId: null } }, true)).toEqual(none);
    expect(conversationActions(context, { ...detail, ticket: { ...detail.ticket, status: "open" }, binding: { ...detail.binding!, mode: "waiting_human", assignedOperatorId: null } }, true)).toEqual({ claim: true, send: false, close: false });
  });
});
