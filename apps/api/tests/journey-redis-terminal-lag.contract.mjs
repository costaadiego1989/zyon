import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { disconnectCapturedJourneyRedis } from "./storefront-journey-owned-clients.mjs";

function fixture(status = "ready") {
  const socket = Object.assign(new EventEmitter(), { closed: true, destroyed: true, connecting: false });
  const client = Object.assign(new EventEmitter(), { status });
  let disconnects = 0, proofs = 0;
  client.disconnect = () => { disconnects++; };
  client.quit = () => assert.fail("a closed socket cannot receive another QUIT");
  const proof = { assertCaptured(owner, stream) {
    proofs++; assert.equal(owner, client); assert.equal(stream, socket);
  } };
  return { client, socket, proof, counts: () => ({ disconnects, proofs }) };
}

test("physical close before SDK end waits for the original terminal event", async () => {
  const f = fixture();
  const terminal = setTimeout(() => { f.client.status = "end"; f.client.emit("end"); }, 5);
  try {
    assert.deepEqual(await disconnectCapturedJourneyRedis(f.client, f.socket, f.proof, 50), { manualDisconnect: false });
    assert.deepEqual(f.counts(), { disconnects: 0, proofs: 1 });
    assert.equal(f.client.status, "end"); assert.equal(f.socket.closed, true);
  } finally { clearTimeout(terminal); }
});

test("a physically closed client that never ends still rejects within its original budget", async () => {
  const f = fixture();
  await assert.rejects(disconnectCapturedJourneyRedis(f.client, f.socket, f.proof, 15), /journey_owned_redis_disconnect_close_timeout/);
  assert.deepEqual(f.counts(), { disconnects: 0, proofs: 1 });
  assert.equal(f.client.listenerCount("end"), 0); assert.equal(f.socket.listenerCount("close"), 0);
});

test("closed foreign sockets cannot acquire cleanup authority", async () => {
  const f = fixture();
  await assert.rejects(disconnectCapturedJourneyRedis(f.client, new EventEmitter(), f.proof, 50));
  assert.equal(f.counts().disconnects, 0); assert.equal(f.client.listenerCount("end"), 0);
});

test("an already ended and physically closed owner needs no additional disconnect", async () => {
  const f = fixture("end");
  assert.deepEqual(await disconnectCapturedJourneyRedis(f.client, f.socket, f.proof, 50), { manualDisconnect: false });
  assert.deepEqual(f.counts(), { disconnects: 0, proofs: 1 });
  assert.equal(f.client.listenerCount("end"), 0); assert.equal(f.socket.listenerCount("close"), 0);
});
