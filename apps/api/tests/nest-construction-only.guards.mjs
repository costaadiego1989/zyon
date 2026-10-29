import assert from "node:assert/strict";
import { Socket } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { nativePrismaWorkerEnvironment } from "./native-prisma-admission-guards.mjs";

const flags = ["--local-disposable", "--prisma-loopback-exec", "--construction-only"];
const disabled = ["DATA_RETENTION_ENABLED", "BILLING_PROMOTIONS_ENABLED", "BILLING_ADMIN_NOTIFICATION_ENABLED",
  "REVENUE_WEEKLY_ENABLED", "REVENUE_WEEKLY_GENERATION_ENABLED", "REVENUE_MANAGER_DISCOUNT_RULE_SUGGESTIONS_ENABLED",
  "REVENUE_STRATEGY_MONITOR_ENABLED", "REVENUE_STRATEGY_EXECUTION_ENABLED", "REVENUE_SHARED_LEARNING_ENABLED"];
export function assertConstructionOnlyFlags(args) {
  assert.ok(Array.isArray(args) && (args.length === flags.length || args.length === flags.length + 1)
    && new Set(args).size === args.length && flags.every(flag => args.includes(flag))
    && args.every(flag => flags.includes(flag) || flag === "--compiled-test-artifact"),
  "explicit_nest_construction_only_local_flags_required");
  return args.includes("--compiled-test-artifact") ? "dist-test" : "dist";
}

export function constructionOnlyArtifactEntries(tree) {
  assert.ok(tree === "dist" || tree === "dist-test", "construction_compiled_artifact_tree_required");
  return tree === "dist" ? ["app.module.js"] : ["app.module.js", "test-runner.js",
    "modules/checkout/domain/services/checkout-explicit-address.schema.js",
    "modules/embed/application/update-marketplace-checkout-address.service.js",
    "modules/cross-sell/infrastructure/repositories/prisma-widget-cross-sell-checkout.adapter.js",
    "modules/cross-sell/domain/contracts/widget-cross-sell-checkout-command.schemas.js"];
}
export function constructionOnlyEnvironment(source) {
  return { ...nativePrismaWorkerEnvironment(source), E2E_SEED_ENABLED: "false", RUN_REAL_AI_E2E: "false",
    AACP_RUN_PRISMA_TESTS: "0", REDIS_ENABLED: "true", DB_POOL_SIZE: "2", OTEL_SDK_DISABLED: "true", OTEL_TRACES_EXPORTER: "none",
    ...Object.fromEntries(disabled.map(name => [name, "false"])) };
}
export function assertConstructionOnlyAmbient(env) {
  assert.equal(env.NODE_ENV, "test", "construction_test_environment_required");
  const expected = constructionOnlyEnvironment({});
  const allowed = new Set(["path", "pathext", "systemroot", "windir", "comspec", "temp", "tmp", "tz",
    // Windows injects these platform names into a real Node child even when
    // they were absent from spawn's explicit env. Do not inherit their values
    // from the caller or allow application/provider configuration alongside.
    ...(process.platform === "win32" ? ["homedrive", "homepath", "logonserver", "systemdrive", "userdomain", "username", "userprofile"] : []),
    ...Object.keys(expected).map(name => name.toLowerCase())]);
  assert.ok(Object.keys(env).every(name => allowed.has(name.toLowerCase())), "construction_worker_ambient_configuration_forbidden");
  for (const name of ["DATABASE_URL", "DIRECT_URL", "REDIS_URL", "JWT_SECRET", "BUYER_JWT_SECRET", "EMBED_TOKEN_SECRET",
    "PLATFORM_CONTROL_JWT_SECRET", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY",
    "READY_PROD_TEST_PRISMA_CLIENT", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "STRIPE_SECRET_KEY",
    "STRIPE_SECRET_KEY_TEST", "ASAAS_API_KEY", "ASAAS_API_KEY_SANDBOX", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) {
    assert.equal(env[name], undefined, "construction_worker_ambient_configuration_forbidden");
  }
  for (const [name, value] of Object.entries(expected)) assert.equal(env[name], value, "construction_worker_flags_not_canonical");
}

/** The raw cache factory starts connect() without awaiting it. Construction-
 * only teardown must await its real ready event, not run lifecycle jobs or
 * swallow the offline-queue error from a premature QUIT. */
export function awaitConstructionRedisReady(client, timeoutMs = 5000) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10_000, "bounded_owned_redis_readiness_required");
  if (client.status === "ready") return Promise.resolve();
  if (client.status === "end") return Promise.reject(new Error("construction_owned_redis_ended_before_ready"));
  return new Promise((resolve, reject) => {
    let timer;
    const finish = error => {
      clearTimeout(timer); client.off("ready", ready); client.off("error", failed); client.off("end", ended);
      if (error) reject(error); else resolve();
    };
    const ready = () => finish(), failed = error => finish(error),
      ended = () => finish(new Error("construction_owned_redis_ended_before_ready"));
    client.once("ready", ready); client.once("error", failed); client.once("end", ended);
    timer = setTimeout(() => finish(new Error("construction_owned_redis_ready_timeout")), timeoutMs);
  });
}

/** Called only for an exact, run-owned client already captured from real DI.
 * QUIT's reply and ioredis status are not physical socket-close proof. */
export function closeConstructionRedis(client, stream, timeoutMs = 5000) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10_000, "bounded_owned_redis_close_required");
  return new Promise((resolve, reject) => {
    let timer, finished = false, manualDisconnect = false;
    const finish = error => {
      if (finished) return; finished = true;
      clearTimeout(timer); client.off("end", check); stream?.off("close", check);
      if (error) reject(error); else resolve({ manualDisconnect });
    };
    const check = () => { if (client.status === "end" && (!stream || stream.closed === true)) finish(); };
    const disconnectOpen = () => {
      if (stream && !stream.closed && typeof client.disconnect === "function") {
        manualDisconnect = true; client.disconnect();
      }
      check();
    };
    client.on("end", check); stream?.on("close", check);
    timer = setTimeout(() => finish(new Error("construction_owned_redis_close_timeout")), timeoutMs);
    if (client.status === "end" && stream && !stream.closed && typeof client.disconnect === "function") {
      try { disconnectOpen(); } catch (error) { finish(error); }
    } else if (client.status !== "end") Promise.resolve().then(() => client.quit()).then(disconnectOpen).catch(finish);
    check();
  });
}

/** Capture a connected socket before shutdown can clear its peer tuple. A blank
 * tuple is never new authority: cleanup must retain the same owner/socket pair. */
export function createConstructionRedisSocketProof(port) {
  assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535, "construction_owned_redis_port_required");
  const captured = new WeakMap();
  return Object.freeze({
    async captureAll(entries) {
      const missingPeers = entries.filter(({ socket }) => !socket?.remoteAddress || !socket?.remotePort);
      let rows;
      if (missingPeers.length) {
        assert.equal(process.platform, "win32", "construction_native_tcp_evidence_windows_only");
        const result = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
          `Get-NetTCPConnection -OwningProcess ${process.pid} -State Established -ErrorAction Stop | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess,State | ConvertTo-Json -Compress`],
        { windowsHide: true, timeout: 10_000, maxBuffer: 1_000_000, encoding: "utf8" });
        const parsed = JSON.parse(result.stdout);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      }
      for (const { owner, socket } of entries) {
        if (captured.has(owner)) assert.equal(captured.get(owner), socket, "construction_redis_socket_identity_required");
        if (!socket?.remoteAddress || !socket?.remotePort) {
          assertConstructionRedisNativePeer(socket, port, rows, process.pid);
          captured.set(owner, socket);
        } else this.capture(owner, socket);
      }
      return { nativeTcpCorroborations: missingPeers.length };
    },
    capture(owner, socket) {
      if (captured.has(owner)) assert.equal(captured.get(owner), socket, "construction_redis_socket_identity_required");
      assert.ok(socket instanceof Socket && socket.remoteAddress === "127.0.0.1" && socket.remotePort === port && !socket.closed,
        "construction_redis_socket_ownership_required");
      captured.set(owner, socket);
    },
    assertCaptured(owner, socket) {
      assert.ok(socket instanceof Socket && captured.get(owner) === socket, "construction_redis_socket_identity_required");
      if (socket.remoteAddress) assert.equal(socket.remoteAddress, "127.0.0.1", "construction_redis_socket_ownership_required");
      if (socket.remotePort) assert.equal(socket.remotePort, port, "construction_redis_socket_ownership_required");
    },
  });
}

/** Native TCP corroboration is additional live evidence, never permission to
 * infer ownership from a blank getter, stale status, options or a closed socket. */
export function assertConstructionRedisNativePeer(socket, port, rows, workerPid) {
  assert.ok(socket instanceof Socket && socket.closed === false && !socket.destroyed && !socket.connecting,
    "construction_redis_live_socket_required");
  assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535 && workerPid === process.pid,
    "construction_native_tcp_scope_required");
  const local = socket.address();
  assert.ok(local && typeof local === "object" && local.address === "127.0.0.1"
    && Number.isInteger(local.port) && local.port > 1024, "construction_native_tcp_local_tuple_required");
  assert.ok(Array.isArray(rows), "construction_native_tcp_rows_required");
  const matching = rows.filter(row => row && typeof row === "object" && row.LocalAddress === local.address
    && row.LocalPort === local.port);
  assert.equal(matching.length, 1, "construction_native_tcp_unique_tuple_required");
  const peer = matching[0];
  assert.ok(peer.OwningProcess === workerPid && peer.RemoteAddress === "127.0.0.1" && peer.RemotePort === port
    && (peer.State === 5 || peer.State === "Established"), "construction_native_tcp_ownership_required");
  if (socket.remoteAddress) assert.equal(socket.remoteAddress, peer.RemoteAddress, "construction_redis_socket_ownership_required");
  if (socket.remotePort) assert.equal(socket.remotePort, peer.RemotePort, "construction_redis_socket_ownership_required");
}
