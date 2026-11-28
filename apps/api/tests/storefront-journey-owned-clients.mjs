import assert from "node:assert/strict";
import { Socket } from "node:net";
import { Redis } from "ioredis";
import { Queue, Worker } from "bullmq";
import { ModulesContainer } from "@nestjs/core";
import { awaitConstructionRedisReady, createConstructionRedisSocketProof } from "./nest-construction-only.guards.mjs";
import { assertOwnedJourneyRedisPing } from "./journey-redis-ping-guard.mjs";
import { journeyCleanupDiagnostic } from "./journey-cleanup-diagnostic.mjs";

export async function journeyBounded(work, milliseconds, code) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(code)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
const data = (object, field) => object && Object.getOwnPropertyDescriptor(object, field)?.value;
const socketFor = client => data(data(client, "connector"), "stream");
export function journeyRedisDiagnostic(owner, client, socket = socketFor(client)) {
  const head = client.commandQueue?.peekAt?.(0)?.command?.name;
  return { owner, status: client.status, isSocket: socket instanceof Socket,
    socketClosed: typeof socket?.closed === "boolean" ? socket.closed : null,
    socketDestroyed: typeof socket?.destroyed === "boolean" ? socket.destroyed : null,
    socketConnecting: typeof socket?.connecting === "boolean" ? socket.connecting : null,
    commandQueueLength: Number.isSafeInteger(client.commandQueue?.length) ? client.commandQueue.length : null,
    queueHead: head === undefined ? "none" : head === "quit" ? "quit" : "other" };
}

/** Post-app.close only. Caller must retain the original app.close failure.
 * Physical ownership is asserted BEFORE calling disconnect; no second QUIT,
 * command replay, arbitrary socket destroy or process termination is used. */
export async function disconnectCapturedJourneyRedis(client, socket, proof, timeoutMs = 5000) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10_000, "journey_bounded_owned_disconnect_required");
  proof.assertCaptured(client, socket);
  // Socket closure can be visible before ioredis processes its terminal event.
  // Keep the captured owner and the existing deadline; a closed socket needs
  // no additional disconnect, but the SDK must still reach its real end state.
  const manualDisconnect = socket.closed !== true;
  return new Promise((resolve, reject) => {
    let timer, finished = false;
    const finish = error => {
      if (finished) return; finished = true;
      clearTimeout(timer); client.off("end", check); socket.off("close", check);
      if (error) reject(error); else resolve({ manualDisconnect });
    };
    const check = () => { if (client.status === "end" && socket.closed === true) finish(); };
    client.on("end", check); socket.on("close", check);
    timer = setTimeout(() => finish(Error("journey_owned_redis_disconnect_close_timeout")), timeoutMs);
    try { if (manualDisconnect) client.disconnect(); check(); } catch { finish(Error("journey_owned_redis_disconnect_failed")); }
  });
}

/** Actual DI instances only, data descriptors rather than arbitrary getters.
 * This is harness cleanup, not proof that runtime shutdown needs no help. */
export function createOwnedJourneyClientTracker(app, redisPort) {
  const clients = new Map(), streams = new Map(), generations = new Map(), proof = createConstructionRedisSocketProof(redisPort);
  function generationFor(client, socket) {
    const previous = generations.get(client);
    if (previous?.socket === socket) return previous;
    if (previous) assert.ok(previous.socket.closed === true && previous.socket.destroyed === true && previous.socket.connecting === false,
      "journey_owned_redis_previous_socket_not_closed");
    return { socket, owner: Object.freeze({}), previousOwner: previous?.owner };
  }
  function rememberGeneration(client, socket, generation) {
    const current = generations.get(client);
    if (client.status !== "ready" || socketFor(client) !== socket || socket.closed || socket.destroyed || socket.connecting
      || current !== generation && current?.owner !== generation.previousOwner)
      throw Error("journey_owned_redis_socket_changed_during_capture:" + JSON.stringify(journeyRedisDiagnostic(clients.get(client), client, socket)));
    generations.set(client, generation); streams.set(client, socket);
  }
  const capturedGeneration = Object.freeze({ assertCaptured(client, socket) {
    const generation = generations.get(client);
    assert.ok(generation && generation.socket === socket, "construction_redis_socket_identity_required");
    proof.assertCaptured(generation.owner, socket);
  } });
  async function capture({ ping = true, warmLazy = false } = {}) {
    const queues = new Set(), workers = new Set(), blocking = new Set(), blockingSockets = new Set();
    function recordConnection(connection, name, isBlocking = false) {
      const client = data(connection, "_client");
      if (client instanceof Redis) { clients.set(client, name); if (isBlocking) { blocking.add(client); const socket = socketFor(client); if (socket) blockingSockets.add(socket); } }
    }
    function inspect(value, name) {
      if (value instanceof Redis) clients.set(value, name);
      if (value instanceof Queue) { queues.add(value); recordConnection(data(value, "connection"), "Queue.client"); }
      if (value instanceof Worker) { workers.add(value); recordConnection(data(value, "connection"), "Worker.client"); recordConnection(data(value, "blockingConnection"), "Worker.blockingClient", true); }
    }
    for (const module of app.get(ModulesContainer).values()) for (const wrapper of module.providers.values()) {
      const value = wrapper.instance;
      if (!value || typeof value !== "object") continue;
      inspect(value, value.constructor.name);
      for (const [field, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) if ("value" in descriptor) inspect(descriptor.value, `${value.constructor.name}.${field}`);
    }
    async function captureSockets() {
      const entries = [];
      for (const [client, owner] of clients) {
        assert.equal(client.options.host, "127.0.0.1"); assert.equal(client.options.port, redisPort);
        if (client.status !== "ready") continue;
        const socket = socketFor(client);
        if (!(socket instanceof Socket) || socket.closed || socket.destroyed || socket.connecting)
          throw Error("journey_owned_redis_capture_not_live:" + JSON.stringify(journeyRedisDiagnostic(owner, client, socket)));
        if (streams.get(client) === socket) capturedGeneration.assertCaptured(client, socket);
        else { const generation = generationFor(client, socket); entries.push({ owner: generation.owner, socket, client, generation }); }
      }
      try { await proof.captureAll(entries); }
      catch (cause) {
        const changed = entries.filter(({ client, socket }) => client.status !== "ready" || socketFor(client) !== socket || socket.closed || socket.destroyed || socket.connecting);
        throw Error("journey_owned_redis_capture_failed:" + JSON.stringify({ totalClients: clients.size, queues: queues.size, workers: workers.size, changedCount: changed.length,
          cause: { name: cause?.name, code: typeof cause?.code === "string" ? cause.code.slice(0, 60) : null,
            check: /^construction_[a-z_]+$/.test(cause?.message ?? "") ? cause.message : null, killed: cause?.killed === true,
            signal: ["SIGTERM", "SIGKILL"].includes(cause?.signal) ? cause.signal : null },
          clients: (changed.length ? changed : entries).slice(0, 5).map(({ client, socket }) => ({ ...journeyRedisDiagnostic(clients.get(client), client, socket), socketGenerationChanged: socketFor(client) !== socket })) }));
      }
      for (const { client, socket, generation } of entries) rememberGeneration(client, socket, generation);
    }
    // Ready peers with an available tuple can be captured synchronously before
    // waits. Defer the Windows native TCP query until ALL clients are ready:
    // connecting sockets can be replaced while Get-NetTCPConnection is running.
    function captureDirectPeers() {
      for (const [client] of clients) {
        const socket = socketFor(client);
        if (client.status === "ready" && socket?.remoteAddress && socket?.remotePort) {
          assert.equal(client.options.host, "127.0.0.1"); assert.equal(client.options.port, redisPort);
          try { const generation = generationFor(client, socket); proof.capture(generation.owner, socket); rememberGeneration(client, socket, generation); }
          catch (error) {
            // Diagnostic context cannot grant socket authority or replace the guard failure.
            try {
              const original = streams.get(client), boolean = value => typeof value === "boolean" ? value : null;
              const owner = clients.get(client), status = ["wait", "connecting", "connect", "ready", "close", "reconnecting", "end"].includes(client.status) ? client.status : "other";
              const detail = { stage: "capture_identity_failed",
                ownerKind: owner === "Worker.blockingClient" ? "blocking" : owner === "Worker.client" ? "worker" : owner === "Queue.client" ? "queue" : "provider", status,
                hadCapturedSocket: streams.has(client), socketGenerationChanged: streams.has(client) && original !== socket,
                originalSocketClosed: boolean(original?.closed), originalSocketDestroyed: boolean(original?.destroyed), originalSocketConnecting: boolean(original?.connecting),
                socketClosed: boolean(socket?.closed), socketDestroyed: boolean(socket?.destroyed), socketConnecting: boolean(socket?.connecting) };
              if (typeof error?.message === "string") error.message += ":journey_owned_redis_identity_diagnostic:" + JSON.stringify(detail);
            } catch {/* Retain the same original guard failure if observation is unavailable. */}
            throw error;
          }
        }
      }
    }
    captureDirectPeers();
    for (const queue of queues) clients.set(await journeyBounded(queue.waitUntilReady(), 10_000, "journey_queue_readiness_timeout"), "Queue.client");
    for (const worker of workers) {
      clients.set(await journeyBounded(worker.client, 10_000, "journey_worker_client_timeout"), "Worker.client");
      const client = await journeyBounded(worker.waitUntilReady(), 10_000, "journey_worker_readiness_timeout");
      clients.set(client, "Worker.blockingClient"); blocking.add(client); const socket = socketFor(client); if (socket) blockingSockets.add(socket);
    }
    let readyClients = 0, blockingReadyClients = 0, nonblockingPings = 0;
    for (const [client, owner] of clients) {
      assert.equal(client.options.host, "127.0.0.1"); assert.equal(client.options.port, redisPort);
      if (client.status === "wait" && warmLazy) {
        try { await journeyBounded(client.connect(), 5000, "journey_owned_lazy_redis_connect_timeout"); }
        catch { throw Error(`journey_owned_redis_warm_failed:${owner}:${client.status}`); }
      }
      if (client.status === "wait" || client.status === "end") continue;
      await awaitConstructionRedisReady(client); captureDirectPeers();
    }
    await captureSockets();
    for (const [client] of clients) {
      if (client.status === "wait" || client.status === "end") continue;
      assert.ok(socketFor(client) && streams.get(client) === socketFor(client), "journey_ready_redis_socket_proof_required"); readyClients++;
      if (blocking.has(client) || blockingSockets.has(socketFor(client))) { blockingReadyClients++; continue; }
      if (ping) {
        const pingSocket=socketFor(client);
        await assertOwnedJourneyRedisPing(client);
        assert.equal(socketFor(client),pingSocket,"journey_owned_redis_socket_changed_during_ping");
        capturedGeneration.assertCaptured(client,pingSocket);
        nonblockingPings++;
      }
    }
    return { queues: queues.size, workers: workers.size, redisClients: readyClients, blockingReadyClients, nonblockingPings };
  }
  return Object.freeze({ capture, async close() {
    const errors = []; let manualDisconnects = 0;
    for (const [client] of clients) {
      if (client.status === "wait") continue;
      try {
        const socket = socketFor(client) ?? streams.get(client);
        if (!socket || (socket.closed && client.status === "end")) {
          assert.equal(client.status, "end", "journey_owned_redis_ended_without_open_socket_required"); continue;
        }
        capturedGeneration.assertCaptured(client, socket);
        // The real module hook already attempted shutdown. A pending QUIT on
        // an orphaned client must not receive another queued QUIT from us.
        const closed = await disconnectCapturedJourneyRedis(client, socket, capturedGeneration);
        if (closed.manualDisconnect) manualDisconnects++;
      } catch (error) {
        errors.push(Error("journey_owned_redis_cleanup_failed:" + JSON.stringify({ ...journeyRedisDiagnostic(clients.get(client), client, socketFor(client) ?? streams.get(client)),
          ...journeyCleanupDiagnostic(error),
          cause: ["construction_owned_redis_close_timeout", "journey_owned_redis_disconnect_close_timeout"].includes(error?.message) ? "close_timeout" : "ownership_or_close_failed" })));
      }
    }
    if (errors.length) throw new AggregateError(errors, "journey_owned_redis_cleanup_failed:" + errors.slice(0, 5).map(error => error.message).join("|"));
    return { manualDisconnects, harnessRedisQuits: 0, cleanupHarnessRequired: manualDisconnects > 0, runtimeShutdownValidated: false };
  } });
}
