import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const exec = promisify(execFile);
export function dockerEnvironment(source) {
  const allowed = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"];
  return Object.fromEntries(allowed.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}
export function assertLocalDockerEndpoint(endpoint) {
  assert.equal(endpoint, endpoint.trim(), "docker_endpoint_whitespace_forbidden");
  assert.ok(/^npipe:\/{4}\.\/pipe\/[A-Za-z0-9_.-]+$/.test(endpoint) || /^unix:\/\/\/[^\x00\r\n]+$/.test(endpoint), "local_docker_context_required");
}
export function assertOwnedContainer(info, id, runId) {
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(info.Id, id);
  assert.equal(info.Config.Labels["com.zyon.storefront-write-test"], runId);
  assert.equal(info.Name, `/aacp-write-db-${runId}`);
}

export function assertIsolatedPostgresContainer(info, id, runId) {
  assertOwnedContainer(info, id, runId);
  assert.equal(info.HostConfig.NetworkMode, "none");
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.equal(Object.keys(info.HostConfig.PortBindings ?? {}).length, 0);
  assert.ok(info.Mounts.every(mount => mount.Type === "tmpfs"), "host_or_volume_mount_forbidden");
}

/** Explicit test-only TCP facade; Docker never publishes a port or joins a network. */
export async function openOwnedPostgresBridge({ id, runId, context, endpoint, env, inspect }, spawnProcess = spawn) {
  assert.match(context, /^[A-Za-z0-9_.-]+$/);
  assertLocalDockerEndpoint(endpoint);
  assertIsolatedPostgresContainer(await inspect(), id, runId);
  const sockets = new Set(), children = new Map();
  let closing = false;
  const server = createServer(socket => {
    if (closing) { socket.destroy(); return; }
    sockets.add(socket);
    let child;
    const stop = () => {
      socket.destroy();
      child?.stdin?.destroy(); child?.stdout?.destroy();
      if (child && child.exitCode === null && child.signalCode === null) child.kill();
    };
    socket.on("error", stop);
    socket.on("close", () => { sockets.delete(socket); stop(); });
    try {
      child = spawnProcess("docker", ["--context", context, "exec", "--interactive", id, "nc", "127.0.0.1", "5432"],
        { env: dockerEnvironment(env), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      const ended = new Promise(resolve => child.once("close", () => { children.delete(child); stop(); resolve(); }));
      children.set(child, ended);
      child.on("error", stop);
      child.stdin.on("error", stop); child.stdout.on("error", stop);
      child.stderr.on("error", stop); child.stderr.resume();
      socket.pipe(child.stdin); child.stdout.pipe(socket);
    } catch { stop(); }
  });
  const close = async () => {
    closing = true;
    const stopped = server.listening ? new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) : Promise.resolve();
    const socketClosures = [...sockets].map(socket => socket.closed ? Promise.resolve() : new Promise(resolve => socket.once("close", resolve)));
    for (const socket of sockets) socket.destroy();
    const pending = [...children.values()];
    for (const child of children.keys()) {
      child.stdin.destroy(); child.stdout.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    let timer;
    try {
      await Promise.race([Promise.all([stopped, ...pending, ...socketClosures]), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("owned_bridge_cleanup_timeout")), 5_000); })]);
      assert.equal(sockets.size, 0, "owned_bridge_sockets_remaining");
      assert.equal(children.size, 0, "owned_bridge_children_remaining");
      assert.equal(server.listening, false, "owned_bridge_listener_remaining");
    } finally { clearTimeout(timer); }
  };
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string" && address.address === "127.0.0.1" && address.port > 0);
    return { port: address.port, host: "127.0.0.1", close,
      status: () => ({ listening: server.listening, sockets: sockets.size, children: children.size }) };
  } catch (error) { await close(); throw error; }
}

/** Explicit local harness only: no URL/env-file connection or host PostgreSQL. */
export async function createDisposablePostgres(options = {}) {
  assert.ok(options && typeof options === "object" && !Array.isArray(options));
  assert.ok(Object.keys(options).every(key => key === "transport"), "unknown_disposable_postgres_option");
  const transport = options.transport ?? "unix";
  assert.ok(transport === "unix" || transport === "loopback-exec", "unsupported_disposable_postgres_transport");
  const env = dockerEnvironment(process.env);
  const rawDocker = async (args, input) => {
    const child = exec("docker", args, { env, windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 });
    if (input !== undefined) child.child.stdin.end(input);
    const { stdout } = await child;
    return stdout.trim();
  };
  const context = await rawDocker(["context", "show"]);
  assert.match(context, /^[A-Za-z0-9_.-]+$/);
  const endpoint = await rawDocker(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]);
  assertLocalDockerEndpoint(endpoint);
  const docker = (args, input) => rawDocker(["--context", context, ...args], input);
  const imageId = await docker(["image", "inspect", "postgres:16-alpine", "--format", "{{.Id}}"]);
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  const runId = randomUUID();
  const name = `aacp-write-db-${runId}`;
  let id, bridge, createAttempted = false;
  const inspect = async () => JSON.parse(await docker(["inspect", id]))[0];
  const dispose = async () => {
    let bridgeError;
    try { await bridge?.close(); } catch (error) { bridgeError = error; }
    if (!id && createAttempted) {
      // A lost docker-create ACK must not orphan a container we just created.
      try {
        const created = JSON.parse(await docker(["inspect", name]))[0];
        assertOwnedContainer(created, created.Id, runId);
        id = created.Id;
      } catch (error) {
        if (error.stderr?.includes("No such object") || error.stderr?.includes("No such container")) {
          if (bridgeError) throw bridgeError;
          return;
        }
        throw error;
      }
    }
    if (!id) {
      if (bridgeError) throw bridgeError;
      return;
    }
    const info = await inspect();
    assertOwnedContainer(info, id, runId);
    // Only this UUID-owned container and its own anonymous/temp data; no host FS.
    await docker(["rm", "--force", "--volumes", id]);
    const remaining = await docker(["ps", "--all", "--quiet", "--no-trunc", "--filter", `id=${id}`]);
    assert.equal(remaining, "", "disposable_container_cleanup_failed");
    id = undefined;
    if (bridgeError) throw bridgeError;
  };
  try {
    createAttempted = true;
    id = await docker(["create", "--pull=never", "--name", name,
      "--label", `com.zyon.storefront-write-test=${runId}`, "--network", "none", "--read-only", "--user", "70:70",
      "--memory", "512m", "--cpus", "1", "--pids-limit", "128", "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
      "--tmpfs", "/var/lib/postgresql/data:rw,size=256m,uid=70,gid=70,mode=0700",
      "--tmpfs", "/var/run/postgresql:rw,size=16m,uid=70,gid=70", "--tmpfs", "/tmp:rw,size=16m",
      "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_DB=storefront_synthetic",
      imageId, "postgres", "-c", transport === "unix" ? "listen_addresses=" : "listen_addresses=127.0.0.1", "-c", "max_connections=50", "-c", "shared_buffers=32MB",
      "-c", "log_min_error_statement=panic"]);
    assertOwnedContainer(await inspect(), id, runId);
    await docker(["start", id]);
    const deadline = Date.now() + 25_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const logs = await docker(["logs", id]);
        if (!logs.includes("PostgreSQL init process complete")) throw new Error("initializing");
        await docker(["exec", id, "pg_isready", "-U", "postgres", "-d", "storefront_synthetic"]);
        ready = true; break;
      }
      catch { await new Promise(resolve => setTimeout(resolve, 150)); }
    }
    assert.ok(ready, "disposable_postgres_not_ready");
    const info = await inspect();
    assertIsolatedPostgresContainer(info, id, runId);
    const sql = (query) => docker(["exec", "--interactive", id, "psql", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align",
      "--username=postgres", "--dbname=storefront_synthetic", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=verbose"],
      `SET statement_timeout='12s'; SET lock_timeout='4s'; SET standard_conforming_strings=on;\n${query}`);
    let prismaUrl;
    if (transport === "loopback-exec") {
      const utility = await docker(["exec", id, "sh", "-c", "command -v nc"]);
      assert.match(utility, /^\/(?:usr\/)?bin\/nc$/, "cached_image_nc_required");
      bridge = await openOwnedPostgresBridge({ id, runId, context, endpoint, env, inspect });
      prismaUrl = `postgresql://postgres@127.0.0.1:${bridge.port}/storefront_synthetic?schema=public&connection_limit=24&connect_timeout=15&pool_timeout=15&application_name=aacp_write_native_${runId}`;
    }
    return { sql, dispose, imageId, runId, network: "none", transport, prismaUrl,
      bridgeStatus: () => bridge?.status() ?? { listening: false, sockets: 0, children: 0 } };
  } catch (error) {
    await dispose();
    throw error;
  }
}
