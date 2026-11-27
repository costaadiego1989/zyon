import neo4j from "neo4j-driver";
import { compileGraphRead, graphReadSchema, type GraphReadInput } from "../domain/graph-query.js";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
import { admitGraphRows, GraphResultError } from "../domain/graph-result.js";
import type { GraphReadResult } from "../domain/graph-rag.port.js";
import { compilePublicBusinessRead, publicBusinessReadSchema, type PublicBusinessReadInput } from "../domain/public-business-query.js";
import { admitPublicBusinessRows, type PublicBusinessReadResult } from "../domain/public-business-result.js";
import { neo4jPublicRow } from "../infrastructure/neo4j-public-row.js";

export interface CommunityReadSettings { uri: string; user: string; password: string; database: string; merchantIds: readonly string[] }
export interface GatewayReadEngine { probe(): Promise<boolean>; read(input: GraphReadInput): Promise<GraphReadResult>;
  readPublic?(input: PublicBusinessReadInput): Promise<PublicBusinessReadResult>; close(): Promise<void> }
/** Community's account is implicitly administrative. Only this code-owned read
 * capability is exposed by the separate service; no writer API is present. */
export class CommunityReadEngine implements GatewayReadEngine {
  private driver?: ReturnType<typeof neo4j.driver>;
  private closed = false;
  constructor(private readonly settings: CommunityReadSettings, private readonly clock: () => number = Date.now,
    private readonly factory: typeof neo4j.driver = neo4j.driver) {}
  private connection() {
    if (this.closed) throw Error("query_engine_closed");
    this.driver ??= this.factory(this.settings.uri, neo4j.auth.basic(this.settings.user, this.settings.password), {
      maxConnectionPoolSize: 3, connectionTimeout: 1500, connectionAcquisitionTimeout: 1500, maxTransactionRetryTime: 0,
    });
    return this.driver;
  }
  async probe() {
    try { await this.connection().verifyConnectivity();return true; } catch { return false; }
  }
  async read(value: GraphReadInput): Promise<GraphReadResult> {
    const checked = graphReadSchema.safeParse(value);
    if (!checked.success) return { status: "unavailable", reason: "invalid_input" };
    if (this.closed || !this.settings.merchantIds.includes(checked.data.merchantId)) return { status: "unavailable", reason: "disabled" };
    if (checked.data.modelId !== GRAPH_EMBEDDING_ID) return { status: "unavailable", reason: "invalid_input" };
    const input = { ...checked.data, nowEpochMs: this.clock(), maxAgeMs: Math.min(checked.data.maxAgeMs, 300_000),
      scanLimit: Math.min(checked.data.scanLimit, 2000), threshold: Math.max(checked.data.threshold, 0.65) };
    try {
      const command = compileGraphRead(input), session = this.connection().session({ database: this.settings.database, defaultAccessMode: neo4j.session.READ });
      try {
        const result = await session.executeRead(tx => tx.run(command.text, { ...command.parameters,
          limit: neo4j.int(input.limit), scanLimit: neo4j.int(input.scanLimit) }), { timeout: 2000 });
        const rows = result.records.map(record => Object.fromEntries(Object.entries(record.toObject()).map(([key, item]) =>
          [key, neo4j.isInt(item) ? item.inSafeRange() ? item.toNumber() : NaN : item])));
        return admitGraphRows(input, rows, this.clock);
      } finally { await session.close(); }
    } catch (error) { return { status: "unavailable", reason: error instanceof GraphResultError ? "invalid_result" : "neo4j_unavailable" }; }
  }
  async readPublic(value: PublicBusinessReadInput): Promise<PublicBusinessReadResult> {
    const checked = publicBusinessReadSchema.safeParse(value);
    if (!checked.success) return { status: "unavailable", reason: "invalid_input" };
    if (this.closed || !this.settings.merchantIds.includes(checked.data.merchantId)) return { status: "unavailable", reason: "disabled" };
    const input = { ...checked.data, nowEpochMs: this.clock(), scanLimit: Math.min(checked.data.scanLimit, 2000),
      threshold: Math.max(checked.data.threshold, 0.65) };
    try {
      const command = compilePublicBusinessRead(input), session = this.connection().session({ database: this.settings.database, defaultAccessMode: neo4j.session.READ });
      try {
        const result = await session.executeRead(tx => tx.run(command.text, { ...command.parameters,
          limit: neo4j.int(input.limit), scanLimit: neo4j.int(input.scanLimit) }), { timeout: 2000 });
        try { return admitPublicBusinessRows(input, result.records.map(record => neo4jPublicRow(record.toObject())), this.clock); }
        catch { return { status: "unavailable", reason: "invalid_result" }; }
      } finally { await session.close(); }
    } catch { return { status: "unavailable", reason: "neo4j_unavailable" }; }
  }
  async close() { this.closed = true;await this.driver?.close(); }
}
