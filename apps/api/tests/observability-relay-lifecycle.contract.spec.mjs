import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { observabilityTestEnvironment } from "./observability-harness-lifecycle.mjs";
import * as relayModule from "./observability-loopback-relay.mjs";

function setup(options = {}) {
  assert.equal(typeof relayModule.createRelayProtocol, "function", "relay protocol must be testable without Docker");
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null; child.signalCode = null; let killed = 0;
  child.kill = () => { killed++; if (options.autoClose !== false) queueMicrotask(() => child.emit("close", 0)); return true; };
  const protocol = relayModule.createRelayProtocol(child, { requestTimeoutMs: 20, childExitTimeoutMs: 100, ...options });
  return { child, protocol, killCount: () => killed };
}
test("malformed child JSON rejects pending request, closes transport and preserves a sanitized diagnostic", async () => {
  const { child, protocol, killCount } = setup();
  const pending = protocol.call({ target: "grafana:3000", path: "/api/health", method: "GET", headers: {}, body: "" });
  child.stdout.write("PRIVATE invalid JSON\n");
  await assert.rejects(pending, error => error.message === "relay_protocol_invalid");
  await assert.rejects(protocol.close(), error => error.message === "relay_protocol_invalid");
  assert.ok(killCount() >= 1);
});
test("malformed child response shapes fail closed without forwarding payload", async () => {
  for (const response of [{ id: 1, status: 200, headers: [], body: null }, { id: 1, error: "PRIVATE token" },
    { id: 1, status: 999, headers: [], body: "" }, { id: 1, status: 200, headers: [], body: "!!!!" },
    { id: 1, status: 200, headers: [], body: "A===" }, { id: 1, status: 200, headers: [], body: "YQ" },
    { id: 1, status: 200, headers: [], body: "YR==" }]) {
    const { child, protocol } = setup();
    const pending = protocol.call({ target: "tempo:3200", path: "/ready", method: "GET", headers: {}, body: "" });
    child.stdout.write(JSON.stringify(response) + "\n");
    await assert.rejects(pending, /relay_protocol_invalid/); await assert.rejects(protocol.close(), /relay_protocol_invalid/);
  }
});
test("request timeout poisons the relay and still awaits owned exec child close", async () => {
  const { protocol, killCount } = setup({ requestTimeoutMs: 5 });
  await assert.rejects(protocol.call({ target: "loki:3100", path: "/ready", method: "GET", headers: {}, body: "" }), /relay_timeout/);
  await assert.rejects(protocol.close(), /relay_timeout/); assert.ok(killCount() >= 1);
});
test("successful response and explicit shutdown are deterministic and idempotent", async () => {
  const { child, protocol } = setup();
  const pending = protocol.call({ target: "grafana:3000", path: "/ready", method: "GET", headers: {}, body: "" });
  child.stdout.write(JSON.stringify({ id: 1, status: 200, headers: [["content-type", "text/plain"]], body: Buffer.from("ready").toString("base64") }) + "\n");
  assert.equal((await pending).status, 200); await protocol.close(); await protocol.close();
  await assert.rejects(protocol.call({}), /relay_closed/);
});

test("valid large browser assets do not exhaust the base64 validator stack", async () => {
  const { child, protocol } = setup({ requestTimeoutMs: 1000 });
  const body = Buffer.alloc(16_000_000, 65).toString("base64");
  const pending = protocol.call({ target: "grafana:3000", path: "/public/build/synthetic.js", method: "GET", headers: {}, body: "" });
  child.stdout.write(JSON.stringify({ id: 1, status: 200, headers: [], body }) + "\n");
  try { assert.equal((await pending).body, body); }
  finally { await protocol.close(); }
});
test("shutdown promise remains pending until child closes", async () => {
  const { child, protocol } = setup({ autoClose: false }); let closed = false;
  const closing = protocol.close().then(() => { closed = true; });
  await new Promise(setImmediate); assert.equal(closed, false);
  child.emit("close", 0); await closing; assert.equal(closed, true);
});
test("unexpected child exit rejects outstanding request and is not mistaken for a normal shutdown", async () => {
  const { child, protocol } = setup();
  const pending = protocol.call({ target: "grafana:3000", path: "/ready", method: "GET", headers: {}, body: "" });
  child.emit("close", 17);
  await assert.rejects(pending, /relay_child_closed/); await assert.rejects(protocol.close(), /relay_child_closed/);
});

test("real loopback listener closes and awaits its injected exec child without starting Docker", async () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null; child.signalCode = null;
  child.kill = () => { queueMicrotask(() => child.emit("close", 0)); return true; };
  child.stdin.on("data", chunk => {
    const request = JSON.parse(chunk.toString("utf8"));
    child.stdout.write(JSON.stringify({ id: request.id, status: 200, headers: [], body: Buffer.from("ready").toString("base64") }) + "\n");
  });
  let spawnCount = 0;
  const relay = await relayModule.createLoopbackRelay("owned-synthetic-fixture", { dockerContext: "desktop-linux", spawnProcess: (_command, args, options) => {
    spawnCount++; assert.deepEqual(args.slice(0, 2), ["--context", "desktop-linux"]);
    assert.equal(options.env.NODE_OPTIONS, undefined); return child;
  } });
  const url = await relay.expose("grafana:3000");
  try { assert.equal(await (await fetch(url + "/ready")).text(), "ready"); }
  finally { await relay.close(); }
  assert.equal(spawnCount, 1); await assert.rejects(fetch(url + "/ready"));
});

test("internal relay handles malformed input and foreign target without crashing or requesting a backend", async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../../infra/observability/tests/internal-relay.mjs", import.meta.url))],
    { env: observabilityTestEnvironment(process.env), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.resume();
  const closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  child.stdin.end('PRIVATE malformed\n' + JSON.stringify({ id: 7, target: "forbidden.invalid:443", path: "/", method: "GET", headers: {}, body: "" }) + "\n");
  assert.equal(await closed, 0);
  assert.deepEqual(output.trim().split("\n").map(value => JSON.parse(value)), [
    { id: null, error: "invalid_relay_message" }, { id: 7, error: "isolated_backend_unavailable" },
  ]);
  assert.equal(output.includes("PRIVATE"), false);
});
