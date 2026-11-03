import { createServer, type IncomingMessage } from "node:http";
import { z } from "zod";
import { graphReadSchema } from "../domain/graph-query.js";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
import type { GatewayReadEngine } from "./community-read-engine.js";
import { GRAPH_GATEWAY_MAX_BODY_BYTES, GRAPH_QUERY_PROTOCOL, GRAPH_TEMPLATE_HASH, verifyQuery, signQueryResponse } from "./query-protocol.js";

export interface QueryGatewaySettings { keyId: string; secret: string; merchantIds: readonly string[] }
const admission = z.strictObject({ protocol: z.literal(GRAPH_QUERY_PROTOCOL), templateHash: z.literal(GRAPH_TEMPLATE_HASH),
  merchantIds: z.array(z.string().min(1).max(191)).min(1).max(20) });
export function createQueryGateway(settings: QueryGatewaySettings, engine: GatewayReadEngine, clock: () => number = Date.now) {
  if (!/^[\w-]{1,80}$/.test(settings.keyId) || !/^[a-f0-9]{64}$/.test(settings.secret) || !settings.merchantIds.length)
    throw Error("query_service_unconfigured");
  const nonces = new Map<string, number>();
  let concurrent = 0, windowStart = clock(), windowReads = 0, stopping = false;
  let health: Promise<boolean> | undefined, healthCheckedAt = 0;
  const probeHealth = () => {
    if (!health || clock() - healthCheckedAt >= 10_000) { healthCheckedAt = clock();health = engine.probe().catch(() => false); }
    return health;
  };
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown, nonce?: string) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store",
        ...(nonce ? { "x-zyon-response-signature": signQueryResponse(settings.secret, nonce, status, text) } : {}) });res.end(text);
    };
    if (stopping) { send(503, { error: "unavailable" });return; }
    if (req.method === "GET" && req.url === "/health") { send(await probeHealth() ? 200 : 503, { service: "graph-query", protocol: GRAPH_QUERY_PROTOCOL });return; }
    if (req.method !== "POST" || !["/v1/read", "/v1/admission"].includes(req.url ?? "")) { send(404, { error: "unknown_operation" });return; }
    if (concurrent >= 4) { send(429, { error: "capacity" });return; }
    concurrent++;
    try {
      const body = await readBody(req), path = req.url!;
      const headers = { keyId: single(req, "x-zyon-key-id"), timestamp: single(req, "x-zyon-timestamp"),
        nonce: single(req, "x-zyon-nonce"), signature: single(req, "x-zyon-signature") };
      if (headers.keyId !== settings.keyId || !verifyQuery(settings.secret, headers, path, body, clock())) { send(401, { error: "unauthorized" });return; }
      for (const [nonce, until] of nonces) if (until < clock()) nonces.delete(nonce);
      if (nonces.has(headers.nonce)) { send(401, { error: "replayed" });return; }
      if (nonces.size >= 10_000) { send(429, { error: "capacity" });return; }
      nonces.set(headers.nonce, clock() + 60_000);
      if (clock() - windowStart >= 1000) { windowStart = clock();windowReads = 0; }
      if (++windowReads > 20) { send(429, { error: "capacity" }, headers.nonce);return; }
      let value: unknown;
      try { value = JSON.parse(body); } catch { send(400, { error: "invalid_input" }, headers.nonce);return; }
      if (path === "/v1/admission") {
        const checked = admission.safeParse(value);
        if (!checked.success || checked.data.merchantIds.some(id => !settings.merchantIds.includes(id))) { send(403, { error: "scope_or_protocol" }, headers.nonce);return; }
        if (!await engine.probe()) { send(503, { error: "unavailable" }, headers.nonce);return; }
        send(200, { protocol: GRAPH_QUERY_PROTOCOL, templateHash: GRAPH_TEMPLATE_HASH, modelId: GRAPH_EMBEDDING_ID,
          merchantIds: checked.data.merchantIds, mode: "community_controlled", operations: ["catalog", "knowledge"] }, headers.nonce);return;
      }
      const checked = graphReadSchema.safeParse(value);
      if (!checked.success || checked.data.modelId !== GRAPH_EMBEDDING_ID) { send(400, { error: "invalid_input" }, headers.nonce);return; }
      if (!settings.merchantIds.includes(checked.data.merchantId)) { send(403, { error: "scope" }, headers.nonce);return; }
      const result = await engine.read(checked.data);
      send(result.status === "ready" ? 200 : 503, result, headers.nonce);
    } catch { if (!res.headersSent) send(400, { error: "invalid_or_incomplete_request" }); }
    finally { concurrent--; }
  });
  server.headersTimeout = 5000;server.requestTimeout = 5000;server.keepAliveTimeout = 1000;
  return { server, async close() {
    stopping = true;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await engine.close();
  } };
}
function single(req: IncomingMessage, key: string): string {
  const value = req.headers[key];return typeof value === "string" ? value : "";
}
async function readBody(req: IncomingMessage): Promise<string> {
  if (req.headers["content-type"] !== "application/json" || Number(req.headers["content-length"] ?? 0) > GRAPH_GATEWAY_MAX_BODY_BYTES)
    throw Error("invalid_body");
  const chunks: Buffer[] = [];let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > GRAPH_GATEWAY_MAX_BODY_BYTES) { req.destroy();throw Error("body_limit"); }
    chunks.push(Buffer.from(chunk));
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}
