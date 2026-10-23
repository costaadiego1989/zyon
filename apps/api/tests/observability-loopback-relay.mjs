import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { finishChild, observabilityTestEnvironment } from "./observability-harness-lifecycle.mjs";

const targets = new Set(["prometheus:9090", "loki:3100", "tempo:3200", "tempo:4318", "alloy:9999", "grafana:3000", "fixture:8080"]);

export function relayHeaders(source, target, origin) {
  const headers = Object.fromEntries(Object.entries(source).filter(([key]) => !["connection", "transfer-encoding", "accept-encoding", "content-length"].includes(key)));
  headers.host = target;
  // Preserve same-origin semantics across this test-only reverse proxy. Foreign
  // origins stay foreign: never disable Grafana CSRF or strip its Origin check.
  if (headers.origin === origin) headers.origin = `http://${target}`;
  if (typeof headers.referer === "string" && headers.referer.startsWith(`${origin}/`))
    headers.referer = `http://${target}${headers.referer.slice(origin.length)}`;
  return headers;
}

export function createRelayProtocol(child, { requestTimeoutMs = 20000, childExitTimeoutMs = 3000 } = {}) {
  const pending = new Map();
  let sequence = 0, closing = false, childClosed = false, terminationRequested = false, failure, closePromise;
  const rejectAll = error => {
    for (const value of pending.values()) { clearTimeout(value.timeout); value.reject(error); }
    pending.clear();
  };
  const fail = reason => {
    failure ??= new Error(reason);
    rejectAll(failure);
    if (!terminationRequested && !childClosed) {
      terminationRequested = true;
      try { child.stdin.end(); child.kill(); } catch { /* close() verifies termination separately. */ }
    }
  };
  child.on("error", () => { if (!closing) fail("relay_child_failed"); });
  child.on("close", () => { childClosed = true; if (!closing) fail("relay_child_closed"); });
  child.stdin.on("error", () => { if (!closing) fail("relay_child_failed"); });
  child.stdout.on("error", () => { if (!closing) fail("relay_child_failed"); });
  child.stderr.resume(); // no payload/credential logging
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", line => {
    if (failure || closing) return;
    try {
      assert.ok(line.length <= 24_000_000);
      const value = JSON.parse(line);
      assert.ok(value && typeof value === "object" && Number.isSafeInteger(value.id) && value.id > 0);
      if (Object.hasOwn(value, "error")) assert.equal(value.error, "isolated_backend_unavailable");
      else {
        assert.ok(Number.isInteger(value.status) && value.status >= 100 && value.status <= 599);
        assert.ok(Array.isArray(value.headers) && value.headers.length <= 200 && value.headers.every(header =>
          Array.isArray(header) && header.length === 2 && typeof header[0] === "string"
          && (typeof header[1] === "string" || Array.isArray(header[1]) && header[1].every(item => typeof item === "string"))));
        // One character-class scan, then only a final-quad canonical roundtrip:
        // no nested repetition/stack growth or whole-asset decoding allocation.
        assert.ok(typeof value.body === "string" && value.body.length % 4 === 0
          && /^[A-Za-z0-9+/]*={0,2}$/.test(value.body)
          && Buffer.from(value.body.slice(-4), "base64").toString("base64") === value.body.slice(-4));
      }
      const task = pending.get(value.id);
      if (!task) return; // A bounded request may already have completed.
      clearTimeout(task.timeout); pending.delete(value.id);
      value.error ? task.reject(new Error("isolated_backend_unavailable")) : task.resolve(value);
    } catch { fail("relay_protocol_invalid"); }
  });
  lines.on("error", () => fail("relay_protocol_invalid"));
  const call = message => new Promise((resolve, reject) => {
    if (closing || childClosed || failure || child.stdin.destroyed) { reject(failure ?? new Error("relay_closed")); return; }
    if (!targets.has(message?.target) || typeof message.path !== "string" || !message.path.startsWith("/") || message.path.startsWith("//")) {
      reject(new Error("invalid_relay_target")); return;
    }
    const id = ++sequence;
    const timeout = setTimeout(() => fail("relay_timeout"), requestTimeoutMs);
    pending.set(id, { resolve, reject, timeout });
    try { child.stdin.write(JSON.stringify({ ...message, id }) + "\n"); } catch { fail("relay_child_failed"); }
  });
  return { call, close() {
    return closePromise ??= (async () => {
      closing = true; rejectAll(failure ?? new Error("relay_closed")); lines.close();
      let cleanup;
      try { if (!childClosed) await finishChild(child, { timeoutMs: childExitTimeoutMs }); } catch (error) { cleanup = error; }
      if (failure && cleanup) throw new AggregateError([failure, cleanup], "relay_failure_and_cleanup_failed");
      if (failure) throw failure;
      if (cleanup) throw cleanup;
    })();
  } };
}

export async function createLoopbackRelay(containerName, { dockerContext, spawnProcess = spawn } = {}) {
  if (dockerContext !== undefined) assert.match(dockerContext, /^[A-Za-z0-9_.-]+$/);
  const child = spawnProcess("docker", [...(dockerContext ? ["--context", dockerContext] : []), "exec", "-i", containerName, "node", "/fixture/internal-relay.mjs"], {
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: observabilityTestEnvironment(process.env),
  });
  const protocol = createRelayProtocol(child), servers = [];
  let closing;
  return {
    async expose(target) {
      assert.ok(!closing && targets.has(target), "invalid_relay_target");
      const server = createServer(async (req, res) => {
        try {
          const chunks = []; let length = 0;
          for await (const chunk of req) { length += chunk.length; assert.ok(length <= 2_000_000); chunks.push(chunk); }
          const localHost = `127.0.0.1:${server.address().port}`;
          if (req.headers.host !== localHost) { res.writeHead(403).end(); return; }
          const headers = relayHeaders(req.headers, target, `http://${localHost}`);
          const response = await protocol.call({ target, path: req.url, method: req.method, headers, body: Buffer.concat(chunks).toString("base64") });
          for (const [key, value] of response.headers)
            if (!["connection", "transfer-encoding", "content-length", "content-encoding"].includes(key)) res.setHeader(key, value);
          res.writeHead(response.status); res.end(Buffer.from(response.body, "base64"));
        } catch { res.writeHead(502); res.end("isolated_backend_unavailable"); }
      });
      server.on("upgrade", (_req, socket) => socket.destroy()); // live streaming is outside this test
      servers.push(server);
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      assert.equal(server.address().address, "127.0.0.1");
      return `http://127.0.0.1:${server.address().port}`;
    },
    close() {
      return closing ??= (async () => {
        const errors = [];
        for (const server of servers) {
          try { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
          catch (error) { errors.push(error); }
        }
        try { await protocol.close(); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, "relay_cleanup_failed");
      })();
    },
  };
}
