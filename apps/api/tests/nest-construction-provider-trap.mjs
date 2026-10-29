import assert from "node:assert/strict";
import net from "node:net";
import { createServer } from "node:http";

/** Test-only transport rejection, never a successful provider response. The
 * sentinel is run-owned and ephemeral; outbound sockets can reach only the two
 * already verified owned data-service ports. */
export async function installConstructionProviderTrap(databasePort, redisPort) {
  const allowed = new Set([databasePort, redisPort]);
  assert.ok([...allowed].every(port => Number.isInteger(port) && port > 1024 && port <= 65535));
  const counts = { fetchCalls: 0, unownedSocketAttempts: 0, sentinelRequests: 0 };
  const sockets = new Set();
  const server = createServer((_request, response) => {
    counts.sentinelRequests++; response.writeHead(503); response.end("construction_provider_forbidden");
  });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string" && address.address === "127.0.0.1");
  const fetch = globalThis.fetch, connect = net.Socket.prototype.connect;
  globalThis.fetch = async () => { counts.fetchCalls++; throw new Error("construction_provider_fetch_forbidden"); };
  net.Socket.prototype.connect = function (...args) {
    const normalized = Array.isArray(args[0]) ? args[0] : args;
    const first = normalized[0];
    const host = first && typeof first === "object" ? first.host ?? "127.0.0.1"
      : typeof normalized[1] === "string" ? normalized[1] : "127.0.0.1";
    const port = Number(first && typeof first === "object" ? first.port : first);
    if (!["127.0.0.1", "::1", "[::1]"].includes(host) || !allowed.has(port) || first?.path) {
      counts.unownedSocketAttempts++; throw new Error("construction_unowned_socket_forbidden");
    }
    return connect.apply(this, args);
  };
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    evidence: () => ({ ...counts, providerCalls: counts.fetchCalls + counts.unownedSocketAttempts + counts.sentinelRequests }),
    async dispose() {
      try {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        assert.equal(server.listening, false); assert.equal(sockets.size, 0);
      } finally { globalThis.fetch = fetch; net.Socket.prototype.connect = connect; }
    },
  };
}
