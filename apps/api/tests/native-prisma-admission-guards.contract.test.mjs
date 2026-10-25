import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { connect } from "node:net";
import path from "node:path";
import { assertIsolatedPostgresContainer, openOwnedPostgresBridge, createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { nativePrismaWorkerEnvironment, assertNativePrismaUrl, assertGeneratedPrismaEnvironment, terminateOwnedNativeWorker } from "./native-prisma-admission-guards.mjs";

const id = "a".repeat(64), runId = "12345678-1234-1234-1234-123456789abc";
const info = { Id: id, Name: `/aacp-write-db-${runId}`, Config: { Labels: { "com.zyon.storefront-write-test": runId } }, HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, PortBindings: {} }, Mounts: [] };
const url = `postgresql://postgres@127.0.0.1:49222/storefront_synthetic?schema=public&connection_limit=24&connect_timeout=15&pool_timeout=15&application_name=aacp_write_native_${runId}`;

test("native worker strips URL/provider/Docker/Node injection variables", () => {
  assert.deepEqual(nativePrismaWorkerEnvironment({ PATH: "fixture", TEMP: "fixture-temp", DATABASE_URL: "forbidden", NODE_OPTIONS: "forbidden", DOCKER_HOST: "forbidden", OPENAI_API_KEY: "forbidden", HOME: "forbidden" }), { PATH: "fixture", TEMP: "fixture-temp", NODE_ENV: "test" });
});
test("only the explicit synthetic loopback URL and bounded single-engine pool is admitted", () => {
  assert.doesNotThrow(() => assertNativePrismaUrl(url));
  for (const changed of [url.replace("127.0.0.1", "localhost"), url.replace("127.0.0.1", "10.0.0.1"), url.replace("49222", "5432").replace("postgresql:", "mysql:"), url.replace("postgres@", "postgres:secret@"), url.replace("storefront_synthetic", "production"), url + "&host=external", url.replace("connection_limit=24", "connection_limit=100"), url.replace("schema=public", "schema=other"), url + "#fragment"])
    assert.throws(() => assertNativePrismaUrl(changed));
});
test("generated env metadata is checked before import without reading secret files", () => {
  const workspaceRoot = path.resolve("fixture-workspace"), apiRoot = path.join(workspaceRoot, "apps", "api"), generatedDirectory = path.join(workspaceRoot, "node_modules", ".prisma", "client");
  const base = { source: '"relativeEnvPaths": {"rootEnvPath":null}', workspaceRoot, apiRoot, generatedDirectory, exists: file => file === path.join(generatedDirectory, "schema.prisma") };
  assert.equal(assertGeneratedPrismaEnvironment(base).checkedCount, 4);
  for (const existing of [path.join(workspaceRoot, ".env"), path.join(apiRoot, ".env"), path.join(apiRoot, "prisma", ".env"), path.join(generatedDirectory, ".env")])
    assert.throws(() => assertGeneratedPrismaEnvironment({ ...base, exists: file => file === existing || base.exists(file) }));
  for (const source of ['', '"relativeEnvPaths": {"unexpected":".env"}', '"relativeEnvPaths": {"rootEnvPath":"../../../../outside/.env"}', '"relativeEnvPaths": {"rootEnvPath":"not-an-env-file"}'])
    assert.throws(() => assertGeneratedPrismaEnvironment({ ...base, source }));
  assert.throws(() => assertGeneratedPrismaEnvironment({ ...base, exists: () => false }));
});
test("bridge refuses foreign ownership, host mounts and any Docker-published/networked port", async () => {
  for (const changed of [{ ...info, Id: "b".repeat(64) }, { ...info, Mounts: [{ Type: "bind" }] }, { ...info, HostConfig: { ...info.HostConfig, NetworkMode: "bridge" } }, { ...info, HostConfig: { ...info.HostConfig, PortBindings: { "5432/tcp": [{}] } } }]) {
    assert.throws(() => assertIsolatedPostgresContainer(changed, id, runId));
    await assert.rejects(openOwnedPostgresBridge({ id, runId, context: "desktop-linux", endpoint: "npipe:////./pipe/dockerDesktopLinuxEngine", env: {}, inspect: async () => changed }, () => assert.fail("must reject before child creation")));
  }
});
test("unknown transport options fail before any Docker command", async () => {
  await assert.rejects(createDisposablePostgres({ transport: "external" }));
  await assert.rejects(createDisposablePostgres({ url: "postgresql://external" }));
});
test("bridge binds only ephemeral 127.0.0.1 and closes all sockets and owned exec children", async () => {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter(); Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
    child.stdin.on("data", chunk => child.stdout.write(chunk));
    child.kill = () => { child.signalCode = "SIGTERM"; queueMicrotask(() => child.emit("close", null, "SIGTERM")); return true; };
    return child;
  };
  const bridge = await openOwnedPostgresBridge({ id, runId, context: "desktop-linux", endpoint: "npipe:////./pipe/dockerDesktopLinuxEngine", env: { PATH: "fixture", DOCKER_HOST: "external" }, inspect: async () => info }, spawnProcess);
  let socket;
  try {
    assert.equal(bridge.host, "127.0.0.1"); assert.ok(bridge.port > 1024);
    socket = connect({ host: bridge.host, port: bridge.port }); await once(socket, "connect");
    const received = once(socket, "data"); socket.write("synthetic-byte-stream");
    assert.equal((await received)[0].toString(), "synthetic-byte-stream");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ["--context", "desktop-linux", "exec", "--interactive", id, "nc", "127.0.0.1", "5432"]);
    assert.equal(calls[0].command, "docker"); assert.equal(calls[0].options.windowsHide, true); assert.deepEqual(calls[0].options.env, { PATH: "fixture" });
  } finally { socket?.destroy(); await bridge.close(); }
  assert.deepEqual(bridge.status(), { listening: false, sockets: 0, children: 0 });
  await bridge.close();
});

test("owned native worker termination waits for close and reports timeout instead of hanging", async () => {
  const child = new EventEmitter(); Object.assign(child, { exitCode: null, signalCode: null }); let kills = 0;
  child.kill = () => { kills++; queueMicrotask(() => child.emit("close", null, "SIGTERM")); };
  await terminateOwnedNativeWorker(child, 100);
  assert.equal(kills, 1);
  const stuck = new EventEmitter(); Object.assign(stuck, { exitCode: null, signalCode: null, kill: () => {} });
  await assert.rejects(terminateOwnedNativeWorker(stuck, 5), /owned_native_worker_cleanup_timeout/);
});
