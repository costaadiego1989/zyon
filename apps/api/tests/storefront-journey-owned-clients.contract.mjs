import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { disconnectCapturedJourneyRedis, journeyRedisDiagnostic } from "./storefront-journey-owned-clients.mjs";

// Pure lifecycle doubles: these prove neither Redis ownership nor real app boot.
function fixture({ physicalClose = true } = {}) {
  const socket = Object.assign(new EventEmitter(), { closed: false, destroyed: false, connecting: false });
  const client = Object.assign(new EventEmitter(), { status: "ready", commandQueue: { length: 1, peekAt: () => ({ command: { name: "quit", args: ["never-log-private"] } }) } });
  let disconnects = 0, quits = 0;
  client.quit = () => { quits++; throw Error("second_quit_forbidden"); };
  client.disconnect = () => { disconnects++; client.status = "end"; client.emit("end"); if (physicalClose) queueMicrotask(() => { socket.closed = true; socket.destroyed = true; socket.emit("close"); }); };
  const proof = { assertCaptured(owner, stream) { assert.equal(owner, client); assert.equal(stream, socket); } };
  return { client, socket, proof, counts: () => ({ disconnects, quits }) };
}
test("owned post-close disconnect never queues a second QUIT and awaits physical close", async () => {
  const f = fixture();
  assert.deepEqual(await disconnectCapturedJourneyRedis(f.client, f.socket, f.proof, 50), { manualDisconnect: true });
  assert.deepEqual(f.counts(), { disconnects: 1, quits: 0 }); assert.equal(f.socket.closed, true);
});
test("foreign owner or replaced physical socket cannot authorize disconnect", async () => {
  const f = fixture();
  await assert.rejects(disconnectCapturedJourneyRedis({ ...f.client }, f.socket, f.proof, 50));
  await assert.rejects(disconnectCapturedJourneyRedis(f.client, new EventEmitter(), f.proof, 50));
  assert.deepEqual(f.counts(), { disconnects: 0, quits: 0 });
});
test("client end without physical close stays RED rather than accepting status alone", async () => {
  const f = fixture({ physicalClose: false });
  await assert.rejects(disconnectCapturedJourneyRedis(f.client, f.socket, f.proof, 15), /journey_owned_redis_disconnect_close_timeout/);
  assert.deepEqual(f.counts(), { disconnects: 1, quits: 0 });
});
test("diagnostic emits only a queue-head enum and never command arguments", () => {
  const f = fixture(), diagnostic = journeyRedisDiagnostic("RedisRateLimitStore.redis", f.client, f.socket);
  assert.equal(diagnostic.queueHead, "quit"); assert.equal(JSON.stringify(diagnostic).includes("never-log-private"), false);
  f.client.commandQueue.peekAt = () => ({ command: { name: "eval", args: ["never-log-private"] } });
  assert.equal(journeyRedisDiagnostic("owned", f.client, f.socket).queueHead, "other");
});
