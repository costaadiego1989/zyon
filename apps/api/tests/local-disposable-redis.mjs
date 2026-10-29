import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { dockerEnvironment, assertLocalDockerEndpoint } from "./local-disposable-postgres.mjs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function assertOwnedRedisContainer(info, id, runId) {
  assert.match(runId, uuid); assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(info.Id, id); assert.equal(info.Name, `/aacp-auth-redis-${runId}`);
  assert.equal(info.Config.Labels["com.zyon.auth-redis-test"], runId);
  assert.equal(info.HostConfig.NetworkMode, "none");
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.equal(Object.keys(info.HostConfig.PortBindings ?? {}).length, 0);
  assert.ok(info.Mounts.every(mount => mount.Type === "tmpfs"));
}

export function assertSyntheticRedisIdentity(raw, runId, marker) {
  assert.match(runId, uuid);
  const url = new URL(raw);
  assert.equal(url.protocol, "redis:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.username, ""); assert.equal(url.password, "");
  assert.equal(url.pathname, "/0"); assert.equal(url.search, ""); assert.equal(url.hash, "");
  assert.ok(/^\d+$/.test(url.port) && Number(url.port) > 1024 && Number(url.port) <= 65535 && Number(url.port) !== 6379);
  assert.equal(raw, url.href); assert.equal(marker, runId, "owned_redis_marker_required");
}

/** Explicit test-only Redis; no remote config, published port, volume or pull. */
export async function createDisposableRedis() {
  const env = dockerEnvironment(process.env), execute = promisify(execFile);
  const raw = async args => (await execute("docker", args, {
    env, windowsHide: true, timeout: 30_000, maxBuffer: 1_000_000,
  })).stdout.trim();
  const context = await raw(["context", "show"]);
  assert.match(context, /^[A-Za-z0-9_.-]+$/);
  assertLocalDockerEndpoint(await raw(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]));
  const docker = args => raw(["--context", context, ...args]);
  const image = await docker(["image", "inspect", "redis:7-alpine", "--format", "{{.Id}}"]);
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const runId = randomUUID(), name = `aacp-auth-redis-${runId}`;
  let id, attempted = false, server, closing = false;
  const sockets = new Set(), children = new Map();
  const inspect = async target => JSON.parse(await docker(["inspect", target]))[0];
  const bridgeStatus = () => ({ listening: server?.listening ?? false, sockets: sockets.size, children: children.size });
  const dispose = async () => {
    closing = true;
    const errors = [];
    try {
      const stopped = server?.listening ? new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) : Promise.resolve();
      const closedSockets = [...sockets].map(socket => socket.closed ? Promise.resolve() : new Promise(resolve => socket.once("close", resolve)));
      const closedChildren = [...children.values()];
      for (const socket of sockets) socket.destroy();
      for (const child of children.keys()) {
        child.stdin.destroy(); child.stdout.destroy();
        if (child.exitCode === null && child.signalCode === null) child.kill();
      }
      let timer;
      try {
        await Promise.race([Promise.all([stopped, ...closedSockets, ...closedChildren]),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("owned_redis_bridge_cleanup_timeout")), 5000); })]);
      } finally { clearTimeout(timer); }
      assert.deepEqual(bridgeStatus(), { listening: false, sockets: 0, children: 0 });
    } catch (error) { errors.push(error); }
    try {
      if (!id && attempted) {
        try { const info = await inspect(name); assertOwnedRedisContainer(info, info.Id, runId); id = info.Id; }
        catch (error) { if (!/No such (?:object|container)/i.test(String(error.stderr ?? ""))) throw error; }
      }
      if (id) {
        assertOwnedRedisContainer(await inspect(id), id, runId);
        await docker(["rm", "--force", id]);
        assert.equal(await docker(["ps", "--all", "--quiet", "--no-trunc", "--filter", `id=${id}`]), "");
        id = undefined;
      }
    } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "owned_redis_cleanup_failed");
  };
  try {
    attempted = true;
    id = await docker(["create", "--pull=never", "--name", name, "--label", `com.zyon.auth-redis-test=${runId}`,
      "--network", "none", "--read-only", "--user", "999:999", "--memory", "128m", "--cpus", "1", "--pids-limit", "64",
      "--cap-drop=ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/data:rw,size=32m,uid=999,gid=999,mode=0700",
      image, "redis-server", "--bind", "127.0.0.1", "--protected-mode", "yes", "--port", "6379", "--save", "", "--appendonly", "no"]);
    assertOwnedRedisContainer(await inspect(id), id, runId);
    await docker(["start", id]);
    let ready = false;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try { assert.equal(await docker(["exec", id, "redis-cli", "PING"]), "PONG"); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, "owned_redis_not_ready");
    assert.equal(await docker(["exec", id, "redis-cli", "SET", "aacp:synthetic:run", runId]), "OK");
    assert.equal(await docker(["exec", id, "redis-cli", "GET", "aacp:synthetic:run"]), runId);
    assertOwnedRedisContainer(await inspect(id), id, runId);
    server = createServer(socket => {
      if (closing) { socket.destroy(); return; }
      sockets.add(socket);
      let child;
      const stop = () => {
        socket.destroy(); child?.stdin?.destroy(); child?.stdout?.destroy();
        if (child && child.exitCode === null && child.signalCode === null) child.kill();
      };
      socket.on("error", stop); socket.on("close", () => { sockets.delete(socket); stop(); });
      try {
        child = spawn("docker", ["--context", context, "exec", "--interactive", id, "nc", "127.0.0.1", "6379"], {
          env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        });
        const ended = new Promise(resolve => child.once("close", () => { children.delete(child); stop(); resolve(); }));
        children.set(child, ended);
        child.on("error", stop); child.stdin.on("error", stop); child.stdout.on("error", stop);
        child.stderr.on("error", stop); child.stderr.resume();
        socket.pipe(child.stdin); child.stdout.pipe(socket);
      } catch { stop(); }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve); });
    const address = server.address();
    assert.ok(address && typeof address !== "string" && address.address === "127.0.0.1");
    const url = `redis://127.0.0.1:${address.port}/0`;
    assertSyntheticRedisIdentity(url, runId, runId);
    return { url, runId, dispose, bridgeStatus, network: "none" };
  } catch (error) {
    try { await dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], "owned_redis_startup_and_cleanup_failed"); }
    throw error;
  }
}
