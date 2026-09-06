import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontConversationGateway } from "./conversation.gateway.js";
import { RealtimeCapabilityService, realtimeRoom } from "../../../../shared/auth/realtime-capability.js";

const capabilities = new RealtimeCapabilityService("test-realtime-secret-at-least-32-characters");
const origin = "https://shop.example";
function connection(token?: string) {
  return {
    connected: true, rooms: new Set<string>(),
    handshake: { auth: { conversationToken: token }, headers: { origin }, query: { merchantId: "attacker_merchant" } },
    emit() {}, disconnect() { this.connected = false; },
    async join(room: string) { this.rooms.add(room); }, async leave(room: string) { this.rooms.delete(room); },
  };
}
function fixture() {
  const calls: unknown[] = []; const broadcasts: Array<{ room: string; event: string }> = [];
  const gateway = new StorefrontConversationGateway(
    { execute: async (input: unknown) => { calls.push(input); return { message: "hello", blocks: [], cart_id: "conv_a" }; } } as never,
    { execute: async () => ({ messages: [] }) } as never, capabilities,
  );
  gateway.server = { to: (room: string) => ({ emit: (event: string) => broadcasts.push({ room, event }) }) } as never;
  const access = capabilities.issue({ purpose: "storefront-conversation", merchantId: "merchant_a", resourceId: "conv_a", origin });
  return { gateway, calls, broadcasts, access };
}

test("anonymous/forged socket cannot subscribe or send with known conversation id", async () => {
  const { gateway, access, calls, broadcasts } = fixture();
  for (const token of [undefined, `${access.token}tampered`]) {
    const socket = connection(token);
    gateway.handleConnection(socket as never);
    assert.equal(socket.connected, false);
    await gateway.handleJoinConversation(socket as never, { conversationId: "conv_a" });
    await gateway.handleMessage(socket as never, { conversationId: "conv_a", text: "secret" });
    assert.equal(socket.rooms.size, 0);
  }
  assert.equal(calls.length, 0); assert.equal(broadcasts.length, 0);
});

test("only issued conversation and cart are authorized; tenant comes from capability", async () => {
  const { gateway, access, calls, broadcasts } = fixture();
  const socket = connection(access.token);
  gateway.handleConnection(socket as never);
  await gateway.handleJoinConversation(socket as never, { conversationId: "conv_a" });
  assert.deepEqual([...socket.rooms], [realtimeRoom("conversation", "merchant_a", "conv_a")]);
  await gateway.handleMessage(socket as never, { conversationId: "conv_a", text: "hello", cartId: "cart_other" });
  assert.equal(calls.length, 0);
  await gateway.handleMessage(socket as never, { conversationId: "conv_a", text: "hello" });
  assert.equal((calls[0] as { merchant_id: string }).merchant_id, "merchant_a");
  assert.ok(broadcasts.every((broadcast) => broadcast.room === realtimeRoom("conversation", "merchant_a", "conv_a")));
  const other = connection(access.token);
  gateway.handleConnection(other as never);
  await gateway.handleJoinConversation(other as never, { conversationId: "conv_other" });
  assert.equal(other.rooms.size, 0); assert.equal(other.connected, false);
  gateway.handleDisconnect(socket as never); gateway.handleDisconnect(other as never);
});

test("reconnect requires valid capability and idle socket disconnects at expiry", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000000 });
  const { gateway, access } = fixture();
  const first = connection(access.token);
  gateway.handleConnection(first as never); gateway.handleDisconnect(first as never);
  const second = connection(access.token);
  gateway.handleConnection(second as never);
  await gateway.handleJoinConversation(second as never, { conversationId: "conv_a" });
  assert.equal(second.rooms.size, 1);
  t.mock.timers.tick(3600000);
  assert.equal(second.connected, false);
  const third = connection(access.token);
  gateway.handleConnection(third as never);
  assert.equal(third.connected, false);
  gateway.handleDisconnect(second as never);
});

test("conversation messages reject invalid content and bound per-connection rate", async () => {
  const { gateway, access, calls } = fixture();
  const socket = connection(access.token); gateway.handleConnection(socket as never);
  for (const text of ["", " ", "x".repeat(4001), 5]) await gateway.handleMessage(socket as never, { conversationId: "conv_a", text } as never);
  assert.equal(calls.length, 0);
  for (let i = 0; i < 22; i++) await gateway.handleMessage(socket as never, { conversationId: "conv_a", text: "hello" });
  assert.equal(calls.length, 20);
  gateway.handleDisconnect(socket as never);
});

test("other-tenant capability never enters the victim tenant room even with the same resource id", async () => {
  const { gateway } = fixture();
  const foreign = capabilities.issue({ purpose: "storefront-conversation", merchantId: "merchant_b", resourceId: "conv_a", origin });
  const client = connection(foreign.token);
  gateway.handleConnection(client as never);
  await gateway.handleJoinConversation(client as never, { conversationId: "conv_a" });
  assert.equal(client.rooms.has(realtimeRoom("conversation", "merchant_a", "conv_a")), false);
  assert.equal(client.rooms.has(realtimeRoom("conversation", "merchant_b", "conv_a")), true);
  gateway.handleDisconnect(client as never);
});
