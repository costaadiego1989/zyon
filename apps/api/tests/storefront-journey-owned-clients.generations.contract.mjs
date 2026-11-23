import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import net, { Socket } from "node:net";
import { once } from "node:events";
import { Redis } from "ioredis";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createOwnedJourneyClientTracker, journeyBounded } from "./storefront-journey-owned-clients.mjs";
import { createConstructionRedisSocketProof } from "./nest-construction-only.guards.mjs";

// Actual loopback TCP/Redis/DI instances, not an AppModule/SQL/provider proof.
// Only fixtures created here may be disconnected/destroyed during final cleanup.
const socketFor = client => Object.getOwnPropertyDescriptor(client.connector, "stream")?.value;
async function endpoint() {
  const peers = new Set(), commands = [];
  const server = net.createServer(socket => {
    peers.add(socket); socket.on("close", () => peers.delete(socket)); let pending = "";
    socket.on("data", chunk => {
      pending += chunk.toString();
      while (pending) {
        const header = /^\*(\d+)\r\n/.exec(pending); if (!header) return;
        let offset = header[0].length; const command = [];
        for (let n = 0; n < Number(header[1]); n++) {
          const bulk = /^\$(\d+)\r\n/.exec(pending.slice(offset)); if (!bulk) return;
          offset += bulk[0].length; const length = Number(bulk[1]); if (pending.length < offset + length + 2) return;
          command.push(pending.slice(offset, offset + length)); offset += length + 2;
        }
        pending = pending.slice(offset); const name = command[0].toLowerCase(); commands.push(name);
        if (name === "quit") socket.end("+OK\r\n"); else socket.write(name === "ping" ? "+PONG\r\n" : "+OK\r\n");
      }
    });
  });
  await new Promise(resolve => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  return { port: server.address().port, commands, peers, async close() {
    for (const peer of peers) peer.destroy();
    await journeyBounded(new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 5000, "generation_fixture_server_close_timeout");
  } };
}
const redis = port => new Redis({ host: "127.0.0.1", port, lazyConnect: true, enableReadyCheck: false,
  maxRetriesPerRequest: 0, retryStrategy: () => null });
async function physicallyClose(client) {
  const socket = socketFor(client); assert.ok(socket instanceof Socket);
  const closed = socket.closed ? Promise.resolve() : once(socket, "close"), ended = client.status === "end" ? Promise.resolve() : once(client, "end");
  client.disconnect(); await journeyBounded(Promise.all([closed, ended]), 5000, "generation_fixture_physical_close_timeout");
  assert.equal(socket.closed, true); assert.equal(socket.destroyed, true); assert.equal(socket.connecting, false); return socket;
}
async function fixture() {
  const own = await endpoint(), client = redis(own.port), extraClients = new Set(), extraEndpoints = new Set(); let app;
  try {
    await client.connect(); assert.equal(await client.ping(), "PONG");
    class OwnedRedisFixtureModule {}
    Module({ providers: [{ provide: "OWNED_REDIS_CLIENT", useValue: client }] })(OwnedRedisFixtureModule);
    app = await NestFactory.createApplicationContext(OwnedRedisFixtureModule, { logger: false });
    const tracker = createOwnedJourneyClientTracker(app, own.port);
    return { own, client, tracker, app,
      async foreign(port) { const peer = redis(port); extraClients.add(peer); await peer.connect(); assert.equal(await peer.ping(), "PONG"); return peer; },
      async otherEndpoint() { const peer = await endpoint(); extraEndpoints.add(peer); return peer; },
      async close() {
        await app.close();
        if (socketFor(client) instanceof Socket && !socketFor(client).closed) await physicallyClose(client); else client.disconnect();
        for (const peer of extraClients) { if (socketFor(peer) instanceof Socket && !socketFor(peer).closed) await physicallyClose(peer); else peer.disconnect(); }
        for (const peer of extraEndpoints) await peer.close(); await own.close();
      } };
  } catch (error) { client.disconnect(); if (app) await app.close(); await own.close(); throw error; }
}

test("same DI Redis client gets a fresh proof only after the old physical socket fully closes", async () => {
  const f = await fixture();
  try {
    assert.equal(f.app.get("OWNED_REDIS_CLIENT"), f.client);
    assert.equal((await f.tracker.capture()).redisClients, 1); const old = socketFor(f.client);
    const original = createConstructionRedisSocketProof(f.own.port); await original.captureAll([{ owner: f.client, socket: old }]);
    await physicallyClose(f.client); await f.client.connect(); assert.equal(await f.client.ping(), "PONG");
    const current = socketFor(f.client); assert.ok(current instanceof Socket); assert.notEqual(current, old);
    assert.equal((await f.tracker.capture()).redisClients, 1);
    original.assertCaptured(f.client, old);
    assert.throws(() => original.assertCaptured(f.client, current), /construction_redis_socket_identity_required/);
    assert.throws(() => original.capture(f.client, current), /construction_redis_socket_identity_required/);
    const result = await f.tracker.close(); assert.equal(result.manualDisconnects, 1); assert.equal(result.harnessRedisQuits, 0);
    assert.equal(result.runtimeShutdownValidated, false); assert.equal(current.closed, true); assert.equal(old.closed, true);
    assert.equal(f.own.commands.filter(command => command === "quit").length, 0);
  } finally { await f.close(); }
});

test("open-old replacement, foreign owner/endpoint and uncaptured replacement never authorize cleanup", async () => {
  const f = await fixture();
  try {
    await f.tracker.capture({ ping: false }); const old = socketFor(f.client), other = await f.otherEndpoint(), foreign = await f.foreign(other.port), foreignSocket = socketFor(foreign);
    const original = createConstructionRedisSocketProof(f.own.port); await original.captureAll([{ owner: f.client, socket: old }]);
    assert.throws(() => original.assertCaptured(foreign, old), /construction_redis_socket_identity_required/);
    f.client.connector.stream = foreignSocket;
    try {
      await assert.rejects(f.tracker.capture({ ping: false })); await assert.rejects(f.tracker.close(), /journey_owned_redis_cleanup_failed/);
      assert.equal(old.closed, false); assert.equal(foreignSocket.closed, false);
    } finally { f.client.connector.stream = old; }
    f.client.options.port = other.port;
    try { await assert.rejects(f.tracker.capture({ ping: false })); assert.equal(old.closed, false); }
    finally { f.client.options.port = f.own.port; }
    await physicallyClose(f.client); await f.client.connect(); const uncaptured = socketFor(f.client);
    await assert.rejects(f.tracker.close(), /journey_owned_redis_cleanup_failed/); assert.equal(uncaptured.closed, false);
    assert.equal(foreignSocket.closed, false); assert.equal(f.own.commands.includes("quit"), false); assert.equal(other.commands.includes("quit"), false);
    await f.tracker.capture({ ping: false }); await f.tracker.close(); assert.equal(uncaptured.closed, true); assert.equal(foreignSocket.closed, false);
  } finally { await f.close(); }
});

test("a new blank peer needs native ownership and a physical change during capture is rejected", async () => {
  const foreignCase = await fixture();
  try {
    await foreignCase.tracker.capture({ ping: false }); await physicallyClose(foreignCase.client);
    const other = await foreignCase.otherEndpoint(); foreignCase.client.options.port = other.port;
    await foreignCase.client.connect(); assert.equal(await foreignCase.client.ping(), "PONG"); assert.ok(other.commands.includes("ping"));
    const foreignSocket = socketFor(foreignCase.client); foreignCase.client.options.port = foreignCase.own.port;
    Object.defineProperty(foreignSocket, "remoteAddress", { configurable: true, get: () => undefined });
    Object.defineProperty(foreignSocket, "remotePort", { configurable: true, get: () => undefined });
    try { await assert.rejects(foreignCase.tracker.capture({ ping: false }), /construction_native_tcp_|construction_redis_socket_ownership_required|journey_owned_redis_capture_failed/); assert.equal(foreignSocket.closed, false); }
    finally { delete foreignSocket.remoteAddress; delete foreignSocket.remotePort; }
  } finally { await foreignCase.close(); }

  const changing = await fixture();
  try {
    await changing.tracker.capture({ ping: false }); await physicallyClose(changing.client); await changing.client.connect();
    const socket = socketFor(changing.client), foreign = await changing.foreign(changing.own.port), replacement = socketFor(foreign);
    const remote = Object.getOwnPropertyDescriptor(Socket.prototype, "remoteAddress").get, address = socket.address; let reads = 0;
    Object.defineProperty(socket, "remoteAddress", { configurable: true, get() { const value = remote.call(this); if (value && ++reads === 2) changing.client.connector.stream = replacement; return value; } });
    Object.defineProperty(socket, "address", { configurable: true, value() { changing.client.connector.stream = replacement; return address.call(this); } });
    try { await assert.rejects(changing.tracker.capture({ ping: false }), /journey_owned_redis_socket_changed_during_capture/); assert.equal(socket.closed, false); assert.equal(replacement.closed, false); }
    finally { changing.client.connector.stream = socket; delete socket.remoteAddress; delete socket.address; }
    await changing.tracker.capture({ ping: false }); await changing.tracker.close(); assert.equal(replacement.closed, false);
    assert.equal(changing.own.commands.includes("quit"), false);
  } finally { await changing.close(); }
});
