import neo4j from "neo4j-driver";
import { z } from "zod";
import { compileGraphRead, graphReadSchema, type GraphReadInput } from "../domain/graph-query.js";
import type { GraphConnectionSettings, GraphProjectionTransactions, GraphReadPort, GraphReadResult, GraphTransaction } from "../domain/graph-rag.port.js";
import { admitGraphRows, GraphResultError } from "../domain/graph-result.js";

interface GraphSession {
  executeRead<T>(work: (tx: GraphTransaction) => Promise<T>, config: { timeout: number }): Promise<T>;
  executeWrite<T>(work: (tx: GraphTransaction) => Promise<T>, config: { timeout: number }): Promise<T>;
  close(): Promise<void>;
}
interface GraphDriver { session(options: { database: string; defaultAccessMode: "READ" | "WRITE" }): GraphSession; close(): Promise<void> }
export type GraphDriverFactory = (uri: string, user: string, password: string) => GraphDriver;
const defaultFactory: GraphDriverFactory = (uri, user, password) => neo4j.driver(uri, neo4j.auth.basic(user, password), {
  maxConnectionPoolSize: 3, connectionAcquisitionTimeout: 2000, connectionTimeout: 2000, maxTransactionRetryTime: 0,
});
class GraphReadAdmissionError extends Error {}

/** The read API accepts a validated need, never Cypher. Projection transactions
 * are a separate trusted-server capability, using a separate authenticated driver. */
export class Neo4jGraphAdapter implements GraphReadPort, GraphProjectionTransactions {
  private reader?: GraphDriver;
  private writer?: GraphDriver;
  private admitted?: Promise<void>;
  private closed = false;
  private readonly merchants: Set<string>;

  constructor(private readonly settings: GraphConnectionSettings, private readonly factory: GraphDriverFactory = defaultFactory,
    private readonly clock: () => number = Date.now) { this.merchants = new Set(settings.merchantIds); }

  enabledFor(merchantId: string): boolean {
    return !this.closed && this.settings.enabled && this.merchants.has(merchantId) && !!this.settings.uri;
  }

  async admitReader(): Promise<boolean> {
    if (this.closed || !this.settings.enabled || !this.settings.merchantIds.length || !this.settings.uri) return false;
    try { await this.readerDriver(); return true; } catch { return false; }
  }

  private requiresReadRole() {
    let loopback = false;
    try { loopback = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(this.settings.uri!).hostname); } catch { /* Invalid config cannot be admitted. */ }
    return this.settings.production || !loopback;
  }

  private async readerDriver(): Promise<GraphDriver> {
    const cfg = this.settings;
    if (!cfg.uri || !cfg.readUser || !cfg.readPassword) throw new Error("graph_read_unconfigured");
    if (this.requiresReadRole() && cfg.readUser === cfg.writeUser) throw new GraphReadAdmissionError();
    this.reader ??= this.factory(cfg.uri, cfg.readUser, cfg.readPassword);
    const driver = this.reader;
    if (this.requiresReadRole()) {
      this.admitted ??= (async () => {
        const session = driver.session({ database: cfg.database, defaultAccessMode: "READ" });
        try {
          const result = await session.executeRead(tx => tx.run("SHOW CURRENT USER YIELD user, roles RETURN user, roles"), { timeout: cfg.timeoutMs });
          const row = result.records.length === 1 ? result.records[0]!.toObject() : undefined;
          const parsed = z.object({ user: z.string(), roles: z.array(z.string()) }).safeParse(row);
          if (!parsed.success || parsed.data.user !== cfg.readUser) throw new GraphReadAdmissionError();
          const roles = parsed.data.roles.map(role => role.toLowerCase());
          if (!roles.includes("reader") || roles.some(role => !["reader", "public"].includes(role))) throw new GraphReadAdmissionError();
        } finally { await session.close(); }
      })();
      try { await this.admitted; } catch (error) { this.admitted = undefined; throw error; }
    }
    return driver;
  }

  async read(value: GraphReadInput): Promise<GraphReadResult> {
    const parsed = graphReadSchema.safeParse(value);
    if (!parsed.success) return { status: "unavailable", reason: "invalid_input" };
    const input = parsed.data;
    if (!this.enabledFor(input.merchantId)) return { status: "unavailable", reason: "disabled" };
    try {
      const command = compileGraphRead(input), driver = await this.readerDriver();
      const session = driver.session({ database: this.settings.database, defaultAccessMode: "READ" });
      try {
        const parameters = { ...command.parameters, limit: neo4j.int(input.limit), scanLimit: neo4j.int(input.scanLimit) };
        const result = await session.executeRead(tx => tx.run(command.text, parameters), { timeout: this.settings.timeoutMs });
        const rows = result.records.map(record => Object.fromEntries(Object.entries(record.toObject()).map(([key, value]) => [key,
            neo4j.isInt(value) ? value.inSafeRange() ? value.toNumber() : NaN : value])));
        return admitGraphRows(input, rows, this.clock);
      } finally { await session.close(); }
    } catch (error) {
      return { status: "unavailable", reason: error instanceof GraphReadAdmissionError ? "reader_not_readonly"
        : error instanceof GraphResultError ? "invalid_result" : "neo4j_unavailable" };
    }
  }

  async withProjection<T>(merchantId: string, work: (transaction: GraphTransaction) => Promise<T>): Promise<T> {
    const cfg = this.settings;
    if (!this.enabledFor(merchantId) || !cfg.uri || !cfg.writeUser || !cfg.writePassword) throw new Error("graph_projection_unavailable");
    this.writer ??= this.factory(cfg.uri, cfg.writeUser, cfg.writePassword);
    const session = this.writer.session({ database: cfg.database, defaultAccessMode: "WRITE" });
    try { return await session.executeWrite(work, { timeout: cfg.timeoutMs }); }
    finally { await session.close(); }
  }

  async close(): Promise<void> {
    this.closed = true;
    const results = await Promise.allSettled([this.reader?.close(), this.writer?.close()]);
    this.reader = this.writer = undefined; this.admitted = undefined;
    if (results.some(result => result.status === "rejected")) throw new Error("graph_driver_close_failed");
  }
}
