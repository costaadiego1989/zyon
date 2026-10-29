import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import { installConstructionProviderTrap } from "./nest-construction-provider-trap.mjs";
import * as constructionGuards from "./nest-construction-only.guards.mjs";
import { assertConstructionOnlyFlags, constructionOnlyEnvironment, assertConstructionOnlyAmbient, awaitConstructionRedisReady } from "./nest-construction-only.guards.mjs";

test("construction opt-ins are exact and cannot accept an arbitrary endpoint/module override", () => {
  assert.doesNotThrow(() => assertConstructionOnlyFlags(["--local-disposable", "--prisma-loopback-exec", "--construction-only"]));
  for (const flags of [[], ["--local-disposable"], ["--local-disposable", "--local-disposable", "--construction-only"],
    ["--local-disposable", "--prisma-loopback-exec", "--construction-only", "--url=postgresql://external.invalid/production"]]) {
    assert.throws(() => assertConstructionOnlyFlags(flags), /explicit_nest_construction_only_local_flags_required/);
  }
});

test("compiled test artifact is an explicit fixed tree with candidate helper preflight and no path override", () => {
  const flags = ["--local-disposable", "--prisma-loopback-exec", "--construction-only"];
  assert.equal(assertConstructionOnlyFlags(flags), "dist");
  assert.equal(assertConstructionOnlyFlags([...flags, "--compiled-test-artifact"]), "dist-test");
  assert.deepEqual(constructionGuards.constructionOnlyArtifactEntries("dist"), ["app.module.js"]);
  const entries = constructionGuards.constructionOnlyArtifactEntries("dist-test");
  assert.ok(entries.includes("app.module.js"));
  assert.ok(entries.includes("modules/checkout/domain/services/checkout-explicit-address.schema.js"));
  for (const tree of ["../dist", "dist-test/../dist", "", null, "external"]) {
    assert.throws(() => constructionGuards.constructionOnlyArtifactEntries(tree), /construction_compiled_artifact_tree_required/);
  }
  for (const extra of [["--compiled-test-artifact=../dist"], ["--compiled-test-artifact", "--compiled-test-artifact"],
    ["--compiled-test-artifact", "--url=external"]]) {
    assert.throws(() => assertConstructionOnlyFlags([...flags, ...extra]), /explicit_nest_construction_only_local_flags_required/);
  }
});
test("child whitelist strips all ambient connection/provider/dotenv/loader configuration", () => {
  const clean = constructionOnlyEnvironment({ PATH: "synthetic-path", DATABASE_URL: "forbidden", REDIS_URL: "forbidden",
    JWT_SECRET: "forbidden", DEEPSEEK_API_KEY: "forbidden", STRIPE_SECRET_KEY_TEST: "forbidden", AWS_PROFILE: "production",
    NODE_OPTIONS: "--env-file=forbidden", CUSTOM_SECRET: "forbidden" });
  assert.equal(clean.PATH, "synthetic-path");
  assertConstructionOnlyAmbient(clean);
  assert.equal(clean.CUSTOM_SECRET, undefined); assert.equal(clean.AWS_PROFILE, undefined);
  assert.throws(() => assertConstructionOnlyAmbient({ ...clean, DATABASE_URL: "forbidden" }), /construction_worker_ambient_configuration_forbidden/);
  assert.throws(() => assertConstructionOnlyAmbient({ ...clean, CUSTOM_SECRET: "forbidden" }), /construction_worker_ambient_configuration_forbidden/);
  assert.throws(() => assertConstructionOnlyAmbient({ ...clean, DATA_RETENTION_ENABLED: "true" }), /construction_worker_flags_not_canonical/);
});
test("the actual Node child accepts only its clean whitelist plus Windows-injected platform names", () => {
  const script = `const {assertConstructionOnlyAmbient}=await import(${JSON.stringify(new URL("./nest-construction-only.guards.mjs", import.meta.url).href)});
    assertConstructionOnlyAmbient(process.env); console.log("clean");`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    env: constructionOnlyEnvironment(process.env), windowsHide: true, encoding: "utf8", timeout: 5000,
  });
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), "clean");
});
test("platform exceptions never admit credential profiles, loader options or unknown application settings", () => {
  const clean = constructionOnlyEnvironment({});
  const windowsNames = Object.fromEntries(["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "SYSTEMDRIVE", "USERDOMAIN", "USERNAME", "USERPROFILE"]
    .map(name => [name, "synthetic-platform"]));
  if (process.platform === "win32") assert.doesNotThrow(() => assertConstructionOnlyAmbient({ ...clean, ...windowsNames }));
  else assert.throws(() => assertConstructionOnlyAmbient({ ...clean, ...windowsNames }), /construction_worker_ambient_configuration_forbidden/);
  for (const name of ["AWS_PROFILE", "AWS_CONFIG_FILE", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "RAILWAY_TOKEN", "PRISMA_ACCELERATE_URL", "USERNAME_SECRET"]) {
    assert.throws(() => assertConstructionOnlyAmbient({ ...clean, [name]: "forbidden" }), /construction_worker_ambient_configuration_forbidden/);
  }
});
test("provider transport trap counts and refuses fetch and unknown sockets before any transport", async () => {
  const trap = await installConstructionProviderTrap(19111, 19112);
  const socket = new net.Socket();
  try {
    assert.equal(trap.evidence().providerCalls, 0);
    await assert.rejects(globalThis.fetch(trap.baseUrl), /construction_provider_fetch_forbidden/);
    assert.throws(() => socket.connect({ host: "external.invalid", port: 443 }), /construction_unowned_socket_forbidden/);
    assert.deepEqual(trap.evidence(), { fetchCalls: 1, unownedSocketAttempts: 1, sentinelRequests: 0, providerCalls: 2 });
  } finally { socket.destroy(); await trap.dispose(); }
});
test("construction cleanup awaits the actual Redis ready event and removes only its own listeners", async () => {
  const client = Object.assign(new EventEmitter(), { status: "connecting" });
  const existingError = () => {}; client.on("error", existingError);
  const ready = awaitConstructionRedisReady(client, 1000);
  client.status = "ready"; client.emit("ready"); await ready;
  assert.equal(client.listenerCount("ready"), 0); assert.equal(client.listenerCount("end"), 0);
  assert.deepEqual(client.listeners("error"), [existingError]);
});
test("construction Redis readiness refuses failures and has a hard deadline without arbitrary sleeps", async () => {
  const client = Object.assign(new EventEmitter(), { status: "connecting" });
  const failed = assert.rejects(awaitConstructionRedisReady(client, 1000), /synthetic_redis_failure/);
  client.emit("error", new Error("synthetic_redis_failure")); await failed;
  await assert.rejects(awaitConstructionRedisReady(client, 1), /construction_owned_redis_ready_timeout/);
  assert.equal(client.eventNames().length, 0);
  client.status = "end";
  await assert.rejects(awaitConstructionRedisReady(client), /construction_owned_redis_ended_before_ready/);
});

test("owned Redis cleanup must await physical socket close, not only a quit reply or status end", async () => {
  const stream = Object.assign(new EventEmitter(), { closed: false });
  let quitCalls = 0;
  const client = Object.assign(new EventEmitter(), { status: "ready", async quit() {
    quitCalls++; this.status = "end"; this.emit("end"); return "OK";
  } });
  let resolved = false;
  const closed = constructionGuards.closeConstructionRedis(client, stream, 1000).then(() => { resolved = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(quitCalls, 1); assert.equal(resolved, false);
  stream.closed = true; stream.emit("close"); await closed;
  assert.equal(resolved, true); assert.equal(stream.listenerCount("close"), 0);
});

test("owned Redis cleanup never accepts a stale status end with an open socket", async () => {
  const stream = Object.assign(new EventEmitter(), { closed: false });
  const client = Object.assign(new EventEmitter(), { status: "end", async quit() { throw new Error("must_not_quit_ended"); } });
  await assert.rejects(constructionGuards.closeConstructionRedis(client, stream, 1), /construction_owned_redis_close_timeout/);
  assert.equal(stream.listenerCount("close"), 0); assert.equal(client.listenerCount("end"), 0);
});

test("test-only cleanup disconnects an ended BullMQ client with a verified open socket and waits for close", async () => {
  const stream = Object.assign(new EventEmitter(), { closed: false });
  let disconnects = 0;
  const client = Object.assign(new EventEmitter(), { status: "end", disconnect() { disconnects++; } });
  const closed = constructionGuards.closeConstructionRedis(client, stream, 1000);
  assert.equal(disconnects, 1);
  stream.closed = true; stream.emit("close");
  assert.deepEqual(await closed, { manualDisconnect: true });
});

test("a successful QUIT reply still requires closing the verified owned socket", async () => {
  const stream = Object.assign(new EventEmitter(), { closed: false });
  let quitCalls = 0, disconnects = 0;
  const client = Object.assign(new EventEmitter(), { status: "ready", async quit() { quitCalls++; }, disconnect() {
    disconnects++; this.status = "end"; this.emit("end"); stream.closed = true; stream.emit("close");
  } });
  assert.deepEqual(await constructionGuards.closeConstructionRedis(client, stream, 1000), { manualDisconnect: true });
  assert.equal(quitCalls, 1); assert.equal(disconnects, 1);
});

test("socket ownership is captured on the live peer and survives only that exact socket after close", async () => {
  const server = net.createServer();
  const accepted = new Set();
  server.on("connection", socket => { accepted.add(socket); socket.once("close", () => accepted.delete(socket)); });
  await new Promise(resolve => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  const port = server.address().port, owner = {};
  const socket = new net.Socket(), replacement = new net.Socket();
  try {
    await new Promise((resolve, reject) => { socket.once("error", reject); socket.connect({ host: "127.0.0.1", port }, resolve); });
    const proof = constructionGuards.createConstructionRedisSocketProof(port);
    proof.capture(owner, socket); proof.assertCaptured(owner, socket);
    const closed = new Promise(resolve => socket.once("close", resolve)); socket.destroy(); await closed;
    // Node/Windows may retain the cached peer after destroy; explicitly model
    // the cleared-peer transition observed in the real construction run.
    Object.defineProperties(socket, { remoteAddress: { value: "", configurable: true }, remotePort: { value: undefined, configurable: true } });
    assert.doesNotThrow(() => proof.assertCaptured(owner, socket));
    assert.throws(() => proof.assertCaptured(owner, replacement), /construction_redis_socket_identity_required/);
    assert.throws(() => proof.capture({}, replacement), /construction_redis_socket_ownership_required/);
    assert.throws(() => proof.assertCaptured({}, socket), /construction_redis_socket_identity_required/);
  } finally {
    socket.destroy(); replacement.destroy(); for (const peer of accepted) peer.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("native TCP corroboration requires one established worker-owned exact loopback tuple", async () => {
  const peers = new Set(), server = net.createServer(socket => { peers.add(socket); socket.on("close", () => peers.delete(socket)); });
  await new Promise(resolve => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  const socket = new net.Socket(), port = server.address().port;
  try {
    await new Promise((resolve, reject) => { socket.once("error", reject); socket.connect({ host: "127.0.0.1", port }, resolve); });
    const row = { LocalAddress: "127.0.0.1", LocalPort: socket.address().port, RemoteAddress: "127.0.0.1",
      RemotePort: port, OwningProcess: process.pid, State: 5 };
    const check = rows => constructionGuards.assertConstructionRedisNativePeer(socket, port, rows, process.pid);
    assert.doesNotThrow(() => check([row]));
    assert.doesNotThrow(() => check([{ ...row, State: "Established" }]));
    for (const override of [{ OwningProcess: process.pid + 1 }, { RemoteAddress: "192.0.2.1" }, { RemotePort: port + 1 },
      { State: 8 }, { State: "CloseWait" }, { OwningProcess: String(process.pid) }]) {
      assert.throws(() => check([{ ...row, ...override }]), /construction_native_tcp_ownership_required/);
    }
    for (const rows of [[], [row, row], [{ ...row, LocalAddress: "::1" }], [{ ...row, LocalPort: row.LocalPort + 1 }]]) {
      assert.throws(() => check(rows), /construction_native_tcp_unique_tuple_required/);
    }
    for (const rows of [null, {}, "invalid"]) assert.throws(() => check(rows), /construction_native_tcp_rows_required/);
    assert.throws(() => constructionGuards.assertConstructionRedisNativePeer(socket, port, [row], process.pid + 1),
      /construction_native_tcp_scope_required/);
    Object.defineProperty(socket, "remotePort", { configurable: true, value: port + 1 });
    assert.throws(() => check([row]), /construction_redis_socket_ownership_required/);
    delete socket.remotePort;
    const closed = new Promise(resolve => socket.once("close", resolve)); socket.destroy(); await closed;
    assert.throws(() => check([row]), /construction_redis_live_socket_required/);
  } finally {
    socket.destroy(); for (const peer of peers) peer.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("real ioredis loopback PING uses native corroboration when Node peer getters are blank and closes the same socket", async () => {
  const peers = new Set();
  const server = net.createServer(socket => {
    peers.add(socket); socket.on("close", () => peers.delete(socket));
    let pending = "";
    socket.on("data", data => {
      pending += data.toString();
      while (pending) {
        const header = /^\*(\d+)\r\n/.exec(pending); if (!header) return;
        let offset = header[0].length; const command = [];
        for (let n = 0; n < Number(header[1]); n++) {
          const bulk = /^\$(\d+)\r\n/.exec(pending.slice(offset)); if (!bulk) return;
          offset += bulk[0].length; const length = Number(bulk[1]);
          if (pending.length < offset + length + 2) return;
          command.push(pending.slice(offset, offset + length)); offset += length + 2;
        }
        pending = pending.slice(offset);
        socket.write(command[0].toLowerCase() === "ping" ? "+PONG\r\n" : "+OK\r\n");
      }
    });
  });
  await new Promise(resolve => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  const port = server.address().port;
  const client = new Redis({ host: "127.0.0.1", port, lazyConnect: true, enableReadyCheck: false,
    maxRetriesPerRequest: 0, retryStrategy: () => null });
  const replacement = new net.Socket();
  try {
    await client.connect(); assert.equal(await client.ping(), "PONG");
    const socket = Object.getOwnPropertyDescriptor(client.connector, "stream").value;
    const blankPeer = !socket.remoteAddress || !socket.remotePort;
    const proof = constructionGuards.createConstructionRedisSocketProof(port);
    const result = await proof.captureAll([{ owner: client, socket }]);
    assert.equal(result.nativeTcpCorroborations, blankPeer ? 1 : 0);
    proof.assertCaptured(client, socket);
    assert.throws(() => proof.assertCaptured(client, replacement), /construction_redis_socket_identity_required/);
    assert.throws(() => proof.capture(client, replacement), /construction_redis_socket_identity_required/);
    await constructionGuards.closeConstructionRedis(client, socket);
    assert.equal(socket.closed, true); assert.equal(client.status, "end"); proof.assertCaptured(client, socket);
  } finally {
    replacement.destroy(); client.disconnect(); for (const peer of peers) peer.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
for (const [name, args] of [["implicit", []], ["foreign endpoint", ["--local-disposable", "--prisma-loopback-exec", "--construction-only", "--url=external"]]]) {
  test(`harness rejects ${name} invocation before Docker/client/artifact inspection`, () => {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("./nest-construction-only.integration.mjs", import.meta.url)), ...args], {
      env: constructionOnlyEnvironment(process.env), windowsHide: true, encoding: "utf8", timeout: 5000,
    });
    assert.equal(child.error, undefined); assert.equal(child.status, 1); assert.equal(child.stdout, "");
    assert.match(child.stderr, /explicit_nest_construction_only_local_flags_required/);
    assert.doesNotMatch(child.stderr, /compiled_app_module_required|PrismaClientInitializationError|Docker/i);
  });
}
test("worker rejects a foreign database before importing a client or AppModule", () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("./nest-construction-only.worker.mjs", import.meta.url)),
    "postgresql://postgres@external.invalid/storefront_synthetic", "11111111-1111-4111-8111-111111111111",
    "redis://127.0.0.1:19999/0", "22222222-2222-4222-8222-222222222222", "dist-test"], {
    env: constructionOnlyEnvironment(process.env), windowsHide: true, encoding: "utf8", timeout: 5000,
  });
  assert.equal(child.error, undefined); assert.equal(child.status, 1); assert.equal(child.stdout, "");
  assert.match(child.stderr, /AssertionError/); assert.doesNotMatch(child.stderr, /PrismaClientInitializationError|Cannot access|UnknownDependenciesException/);
});
