import { z } from "zod";
import { graphReadSchema, type GraphReadInput } from "../domain/graph-query.js";
import { admitGraphRows } from "../domain/graph-result.js";
import type { GraphConnectionSettings, GraphReadResult, GraphRuntimeAdapter, GraphTransaction } from "../domain/graph-rag.port.js";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
import { GRAPH_GATEWAY_MAX_BODY_BYTES, GRAPH_QUERY_PROTOCOL, GRAPH_TEMPLATE_HASH, signQuery, verifyQueryResponse } from "../gateway/query-protocol.js";
import { Neo4jGraphAdapter } from "./neo4j-graph.adapter.js";
import { PUBLIC_BUSINESS_TEMPLATE_HASH, publicBusinessReadSchema, type PublicBusinessReadInput } from "../domain/public-business-query.js";
import { admitPublicBusinessRows, type PublicBusinessReadResult } from "../domain/public-business-result.js";

const capability = z.strictObject({ protocol: z.literal(GRAPH_QUERY_PROTOCOL), templateHash: z.literal(GRAPH_TEMPLATE_HASH),
  modelId: z.literal(GRAPH_EMBEDDING_ID), merchantIds: z.array(z.string()).min(1).max(20), mode: z.literal("community_controlled"),
  operations: z.union([z.tuple([z.literal("catalog"), z.literal("knowledge")]),
    z.tuple([z.literal("catalog"), z.literal("knowledge"), z.literal("merchant_help")])]) });
const ready = z.strictObject({ status: z.literal("ready"), kind: z.enum(["catalog", "knowledge", "merchant_help"]),
  hits: z.array(z.unknown()).max(20), partial: z.literal(true) });
const publicCapability = capability.extend({ templateHash: z.literal(PUBLIC_BUSINESS_TEMPLATE_HASH),
  operations: z.tuple([z.literal("public_business")]) });
const publicReady = z.discriminatedUnion("mode", [
  z.strictObject({ status: z.literal("ready"), kind: z.literal("public_business"), mode: z.literal("sources"), hits: z.array(z.unknown()).max(20), partial: z.literal(true) }),
  z.strictObject({ status: z.literal("ready"), kind: z.literal("public_business"), mode: z.literal("service_professional"), pairs: z.array(z.unknown()).max(10), partial: z.literal(true) }),
]);

export class CommunityGatewayAdapter implements GraphRuntimeAdapter {
  private closed = false;
  private readonly pending = new Set<AbortController>();
  constructor(private readonly settings: GraphConnectionSettings, private readonly writer = new Neo4jGraphAdapter(settings),
    private readonly request: typeof fetch = fetch, private readonly clock: () => number = Date.now) {}
  private enabled(merchantId: string) { return !this.closed && this.settings.enabled && this.settings.merchantIds.includes(merchantId) && !!this.settings.queryGateway; }
  private async call(path: string, value: unknown): Promise<unknown | null> {
    const gateway = this.settings.queryGateway;
    if (this.closed || !this.settings.enabled || !gateway) return null;
    const abort = new AbortController();this.pending.add(abort);
    try {
      const body = JSON.stringify(value), auth = signQuery(gateway.secret, gateway.keyId, path, body, this.clock());
      const response = await this.request(new URL(path, gateway.uri), { method: "POST", redirect: "error", body,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(2200)]), headers: {
          "content-type": "application/json", "x-zyon-key-id": auth.keyId, "x-zyon-timestamp": auth.timestamp,
          "x-zyon-nonce": auth.nonce, "x-zyon-signature": auth.signature,
        } });
      if (response.status !== 200 || response.headers.get("content-type") !== "application/json") return null;
      if (Number(response.headers.get("content-length") ?? 0) > GRAPH_GATEWAY_MAX_BODY_BYTES || !response.body) return null;
      const reader = response.body.getReader();let size = 0;const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const part = await reader.read();if (part.done) break;
          size += part.value.byteLength;
          if (size > GRAPH_GATEWAY_MAX_BODY_BYTES) { await reader.cancel();return null; }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      if (!verifyQueryResponse(gateway.secret, auth.nonce, response.status, text, response.headers.get("x-zyon-response-signature"))) return null;
      return JSON.parse(text);
    } catch { return null; }
    finally { this.pending.delete(abort); }
  }
  async admitReader(): Promise<boolean> {
    if (this.closed || !this.settings.enabled || !this.settings.merchantIds.length) return false;
    const result = capability.safeParse(await this.call("/v1/admission", { protocol: GRAPH_QUERY_PROTOCOL,
      templateHash: GRAPH_TEMPLATE_HASH, merchantIds: this.settings.merchantIds }));
    return result.success && JSON.stringify([...result.data.merchantIds].sort()) === JSON.stringify([...this.settings.merchantIds].sort());
  }
  async read(value: GraphReadInput): Promise<GraphReadResult> {
    const checked = graphReadSchema.safeParse(value);
    if (!checked.success) return { status: "unavailable", reason: "invalid_input" };
    if (!this.enabled(checked.data.merchantId)) return { status: "unavailable", reason: "disabled" };
    const input = { ...checked.data, nowEpochMs: this.clock() };
    const result = ready.safeParse(await this.call("/v1/read", { protocol: GRAPH_QUERY_PROTOCOL, templateHash: GRAPH_TEMPLATE_HASH, input }));
    if (!result.success || result.data.kind !== input.kind) return { status: "unavailable", reason: "neo4j_unavailable" };
    try { return admitGraphRows(input, result.data.hits, this.clock); }
    catch { return { status: "unavailable", reason: "invalid_result" }; }
  }
  async admitPublicReader(): Promise<boolean> {
    if (this.closed || !this.settings.enabled || !this.settings.merchantIds.length) return false;
    const result = publicCapability.safeParse(await this.call("/v1/admission", { protocol: GRAPH_QUERY_PROTOCOL,
      templateHash: PUBLIC_BUSINESS_TEMPLATE_HASH, merchantIds: this.settings.merchantIds }));
    return result.success && JSON.stringify([...result.data.merchantIds].sort()) === JSON.stringify([...this.settings.merchantIds].sort());
  }
  async readPublic(value: PublicBusinessReadInput): Promise<PublicBusinessReadResult> {
    const checked = publicBusinessReadSchema.safeParse(value);
    if (!checked.success) return { status: "unavailable", reason: "invalid_input" };
    if (!this.enabled(checked.data.merchantId)) return { status: "unavailable", reason: "disabled" };
    const input = { ...checked.data, nowEpochMs: this.clock(), scanLimit: Math.min(checked.data.scanLimit, 2000),
      threshold: Math.max(checked.data.threshold, 0.65) };
    const result = publicReady.safeParse(await this.call("/v1/read", { protocol: GRAPH_QUERY_PROTOCOL, templateHash: PUBLIC_BUSINESS_TEMPLATE_HASH, input }));
    if (!result.success || result.data.mode !== input.mode) return { status: "unavailable", reason: "neo4j_unavailable" };
    try { return admitPublicBusinessRows(input, result.data.mode === "sources" ? result.data.hits : result.data.pairs, this.clock); }
    catch { return { status: "unavailable", reason: "invalid_result" }; }
  }
  async withProjection<T>(merchantId: string, work: (tx: GraphTransaction) => Promise<T>) {
    if (!this.enabled(merchantId)) throw Error("graph_projection_unavailable");
    return this.writer.withProjection(merchantId, work);
  }
  async close() { this.closed = true;for (const abort of this.pending) abort.abort();await this.writer.close(); }
}
