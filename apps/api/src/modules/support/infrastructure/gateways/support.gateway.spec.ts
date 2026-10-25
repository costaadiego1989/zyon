import { InMemoryAuthRepository } from "../../../auth/infrastructure/in-memory-auth.repository.js";
import test from "node:test";
import assert from "node:assert/strict";
import { SupportGateway } from "./support.gateway.js";
import { RealtimeCapabilityService, realtimeRoom } from "../../../../shared/auth/realtime-capability.js";
import { JwtService } from "../../../auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../../../auth/domain/services/auth-cookie.service.js";
import { InMemorySupportTicketRepository } from "../in-memory-support-ticket.repository.js";
import { SupportTicketEntity } from "../../domain/entities/support-ticket.entity.js";

const secret = "test-realtime-secret-at-least-32-characters";
const origin = "http://localhost:5175";
const capabilities = new RealtimeCapabilityService(secret);
const cryptoJwt = new JwtService(secret);
const user = { userId: "user_a", merchantId: "merchant_a", email: "owner@example.com", role: "owner" as const };
function socket(auth: Record<string, unknown> = {}, headers: Record<string, string | undefined> = { origin }) {
  return {
    connected: true, rooms: new Set<string>(), emitted: [] as Array<{ event: string; data: unknown }>,
    handshake: { auth, headers, query: { merchantId: "attacker_merchant" } },
    emit(event: string, data: unknown) { this.emitted.push({ event, data }); },
    disconnect() { this.connected = false; },
    async join(room: string) { this.rooms.add(room); }, async leave(room: string) { this.rooms.delete(room); },
  };
}
async function fixture() {
  const sessions = new InMemoryAuthRepository();
  const created = await sessions.createMerchantWithOwner({ merchantId: user.merchantId, merchantName: "Test", email: user.email, passwordHash: "fixture" });
  const principal = { ...user, userId: created.user.id };
  const jwt = new JwtService(secret, 3600, sessions);
  const token = await jwt.issue(principal);
  const tickets = new InMemorySupportTicketRepository();
  const ticket = await tickets.save(SupportTicketEntity.create({ merchantId: "merchant_a", buyerMessage: "private" }).snapshot());
  const other = await tickets.save(SupportTicketEntity.create({ merchantId: "merchant_a", buyerMessage: "other buyer" }).snapshot());
  const foreign = await tickets.save(SupportTicketEntity.create({ merchantId: "merchant_b", buyerMessage: "other tenant" }).snapshot());
  const calls: Array<{ senderType: string; merchantId: string; content: string }> = [];
  const events: Array<{ room: string; event: string }> = [];
  const members = new Map([[user.email, { ...principal, id: principal.userId }]]);
  const gateway = new SupportGateway(
    { execute: async (input: { senderType: string; merchantId: string; content: string }) => { calls.push(input); return { ...input, id: "message_a" }; } } as never,
    jwt, new AuthCookieService(), capabilities, tickets,
    { findUserByEmail: async (email: string) => members.get(email) } as never,
  );
  gateway.server = { to: (room: string) => ({ emit: (event: string) => events.push({ room, event }) }) } as never;
  const access = capabilities.issue({ purpose: "support-ticket", merchantId: ticket.merchantId, resourceId: ticket.id, origin });
  return { gateway, tickets, ticket, other, foreign, calls, events, members, access, jwt, token };
}

test("support rejects anonymous socket and valid buyer JWT cannot assume merchant identity", async () => {
  const { gateway, ticket, calls } = await fixture();
  const buyerJwt = cryptoJwt.sign({ ...user, role: "buyer" } as never);
  for (const auth of [{}, { accessToken: buyerJwt }, { ticketToken: "made_up" }]) {
    const client = socket(auth);
    await gateway.handleConnection(client as never);
    assert.equal(client.connected, false);
    await gateway.handleJoinMerchant(client as never, { merchantId: "merchant_a" });
    await gateway.handleJoinTicket(client as never, { ticketId: ticket.id });
    await gateway.handleSendMessage(client as never, { ticketId: ticket.id, merchantId: "merchant_a", content: "forged merchant" });
    assert.equal(client.rooms.size, 0);
  }
  assert.equal(calls.length, 0);
});

test("buyer capability joins only its ticket and sender role is derived despite spoofed fields", async () => {
  const { gateway, access, ticket, other, foreign, calls, events } = await fixture();
  const client = socket({ ticketToken: access.token });
  await gateway.handleConnection(client as never);
  assert.equal(client.connected, true);
  await gateway.handleJoinMerchant(client as never, { merchantId: "merchant_a" });
  await gateway.handleJoinTicket(client as never, { ticketId: other.id, agentName: "Owner" });
  await gateway.handleJoinTicket(client as never, { ticketId: foreign.id });
  assert.equal(client.rooms.size, 0);
  await gateway.handleJoinTicket(client as never, { ticketId: ticket.id, agentName: "Owner" });
  assert.deepEqual([...client.rooms], [realtimeRoom("ticket", "merchant_a", ticket.id)]);
  assert.equal(events.length, 0, "buyer must not emit agent_joined");
  await gateway.handleSendMessage(client as never, { ticketId: ticket.id, merchantId: "merchant_b", content: "fake" });
  await gateway.handleSendMessage(client as never, { ticketId: other.id, content: "fake" });
  assert.equal(calls.length, 0);
  await gateway.handleSendMessage(client as never, { ticketId: ticket.id, content: "hello", senderType: "merchant", senderName: "Owner" } as never);
  assert.equal(calls[0]?.senderType, "buyer");
  assert.equal(calls[0]?.merchantId, "merchant_a");
  assert.ok(events.every((event) => event.room === realtimeRoom("ticket", "merchant_a", ticket.id)));
  gateway.handleDisconnect(client as never);
});

test("merchant cookie requires allowed Origin; membership and ticket tenant checked on every event", async (t) => {
  const previous = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = origin;
  t.after(() => { if (previous === undefined) delete process.env.CORS_ALLOWED_ORIGINS; else process.env.CORS_ALLOWED_ORIGINS = previous; });
  const { gateway, ticket, foreign, members, calls, token } = await fixture();
  for (const headers of [{ cookie: `aacp_access_token=${token}` }, { origin: "https://evil.example", cookie: `aacp_access_token=${token}` }]) {
    const client = socket({}, headers);
    await gateway.handleConnection(client as never);
    assert.equal(client.connected, false);
  }
  const client = socket({}, { origin, cookie: `aacp_access_token=${token}` });
  await gateway.handleConnection(client as never);
  await gateway.handleJoinMerchant(client as never, { merchantId: "merchant_b" });
  await gateway.handleJoinTicket(client as never, { ticketId: foreign.id });
  assert.equal(client.rooms.size, 0);
  await gateway.handleJoinMerchant(client as never, { merchantId: "merchant_a" });
  await gateway.handleJoinTicket(client as never, { ticketId: ticket.id });
  assert.equal(client.rooms.size, 2);
  await gateway.handleSendMessage(client as never, { ticketId: ticket.id, content: "authorized" });
  assert.equal(calls[0]?.senderType, "merchant");
  members.delete(user.email);
  await gateway.handleSendMessage(client as never, { ticketId: ticket.id, content: "removed member" });
  assert.equal(calls.length, 1); assert.equal(client.connected, false);
  gateway.handleDisconnect(client as never);
});

test("deleted ticket, expired or revoked credential cannot reconnect or perform events", async () => {
  const { gateway, access, tickets, ticket, calls, jwt, token } = await fixture();
  const expired = capabilities.issue({ purpose: "support-ticket", merchantId: "merchant_a", resourceId: ticket.id, origin }, Math.floor(Date.now() / 1000) - 3600);
  const expiredClient = socket({ ticketToken: expired.token });
  await gateway.handleConnection(expiredClient as never); assert.equal(expiredClient.connected, false);
  const client = socket({ ticketToken: access.token });
  await gateway.handleConnection(client as never);
  await tickets.deleteAll("merchant_a");
  await gateway.handleSendMessage(client as never, { ticketId: ticket.id, content: "deleted ticket" });
  assert.equal(calls.length, 0);
  const reconnect = socket({ ticketToken: access.token });
  await gateway.handleConnection(reconnect as never); assert.equal(reconnect.connected, false);
  await jwt.revoke(token);
  const revoked = socket({ accessToken: token }, {});
  await gateway.handleConnection(revoked as never); assert.equal(revoked.connected, false);
  gateway.handleDisconnect(client as never);
});

test("support message content and per-connection volume are bounded", async () => {
  const { gateway, access, ticket, calls } = await fixture();
  const client = socket({ ticketToken: access.token }); await gateway.handleConnection(client as never);
  for (const content of ["", "  ", "x".repeat(4001), null]) await gateway.handleSendMessage(client as never, { ticketId: ticket.id, content } as never);
  assert.equal(calls.length, 0);
  for (let i = 0; i < 32; i++) await gateway.handleSendMessage(client as never, { ticketId: ticket.id, content: "hello" });
  assert.equal(calls.length, 30);
  gateway.handleDisconnect(client as never);
});
