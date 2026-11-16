import type { PublicBusinessSourceProjection, PublicBusinessSourceType, PublicSourcePublication } from "../domain/public-business-source.js";
import { publicWorkSequence } from "./public-source-work-state.js";

export type PublicIndexFailure = "canonical_unavailable" | "embedding_unavailable" | "graph_unavailable" | "invalid_source";
export interface PublicIndexClaim {
  merchantId: string; id: string; leaseToken: string; sourceType: PublicBusinessSourceType; sourceId: string;
  sourceVersion: string; sourceHash: string; publicationState: PublicSourcePublication;
}
export interface PublicIndexPreparedIdentity {
  merchantId: string; sourceType: string; sourceId: string; sourceHash: string; publicRevision: number;
  active: boolean; modelId: string; dimensions: number;
}
export interface PublicIndexQueuePort {
  claimNext(merchantId: string): Promise<PublicIndexClaim | null>;
  /** Checks original ownership under the merchant lock, normalizes canonical
   * data and settles that marker atomically. Never returns new authority. */
  normalizeMarker(claim: Readonly<PublicIndexClaim>): Promise<"normalized" | "lease_lost">;
  /** Checks original lease, latest revision, pending legacy and canonical hash.
   * Superseded is settled conditionally by this adapter, never by the worker. */
  loadSnapshot(claim: Readonly<PublicIndexClaim>): Promise<{ status: "ready"; source: PublicBusinessSourceProjection }
    | { status: "superseded" | "lease_lost" }>;
  failConditional(claim: Readonly<PublicIndexClaim>, code: PublicIndexFailure): Promise<boolean>;
}
export interface PublicIndexProjectionPort<P extends PublicIndexPreparedIdentity> {
  prepare(source: Readonly<PublicBusinessSourceProjection>, version: string): Promise<{ status: "prepared"; projection: P }
    | { status: "unavailable"; reason: "invalid_source" | "embedding_unavailable" }>;
  submit(projection: Readonly<P>): Promise<{ status: "applied" | "ignored" | "unavailable" }>;
}
export interface PublicIndexAdmissionPort<P extends PublicIndexPreparedIdentity> {
  /** Owns ONE real transaction: merchant lock -> original row/token and fresh DB
   * clock -> latest canonical revision/pending markers/hash/publication/model
   * checks -> await submitGraph -> SQL namespace chunks + exact conditional ACK.
   * Any SQL/ACK failure rolls back SQL and propagates. No nested/root writer. */
  commit(claim: Readonly<PublicIndexClaim>, source: Readonly<PublicBusinessSourceProjection>, prepared: Readonly<P>,
    submitGraph: () => Promise<void>): Promise<"completed" | "superseded" | "lease_lost">;
}
export interface PublicIndexReport {
  claimed: number; normalized: number; completed: number; superseded: number; leaseLost: number; failed: number; deferred: number;
  lastFailureCode?: PublicIndexFailure;
}
const emptyReport = (): PublicIndexReport => ({ claimed: 0, normalized: 0, completed: 0, superseded: 0, leaseLost: 0, failed: 0, deferred: 0 });
const types = ["company", "business_hours", "professional", "service", "faq", "policy"];
const validId = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 191;
function snapshot<T>(value: T): Readonly<T> {
  const cloned = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object") { for (const child of Object.values(item)) freeze(child);Object.freeze(item); }
  };
  freeze(cloned);return cloned;
}
export class PublicIndexFailureError extends Error {
  constructor(readonly code: PublicIndexFailure) { super(code); }
}

/** Pure orchestration only. Ports, not this class, own SQL, graph, clock/lease,
 * canonical publication and model-ABI authority. No timer or inline retry. */
export class PublicBusinessIndexWorker<P extends PublicIndexPreparedIdentity> {
  private readonly running = new Map<string, Promise<Readonly<PublicIndexReport>>>();
  private stopping = false;
  constructor(private readonly queue: PublicIndexQueuePort, private readonly projections: PublicIndexProjectionPort<P>,
    private readonly admission: PublicIndexAdmissionPort<P>, private readonly enabledFor: (merchantId: string) => boolean) {}

  runMerchant(merchantId: string, limit = 10): Promise<Readonly<PublicIndexReport>> {
    if (!validId(merchantId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error("public_index_batch_invalid");
    const active = this.running.get(merchantId);if (active) return active;
    if (this.stopping || !this.enabledFor(merchantId)) return Promise.resolve(Object.freeze(emptyReport()));
    const work = Promise.resolve().then(() => this.runBatch(merchantId, limit)).finally(() => { this.running.delete(merchantId); });
    this.running.set(merchantId, work);return work;
  }

  private async runBatch(merchantId: string, limit: number): Promise<Readonly<PublicIndexReport>> {
    const report = emptyReport();
    for (let count = 0; count < limit; count++) {
      if (this.stopping || !this.enabledFor(merchantId)) break;
      let raw: PublicIndexClaim | null;
      try { raw = await this.queue.claimNext(merchantId); }
      catch { report.failed++;report.lastFailureCode = "canonical_unavailable";break; }
      if (raw === null) break;
      if (!raw || raw.merchantId !== merchantId || ![raw.id, raw.leaseToken, raw.sourceId, raw.sourceVersion].every(validId)
        || !types.includes(raw.sourceType) || !/^[a-f0-9]{64}$/.test(raw.sourceHash)
        || !["published", "draft", "withdrawn"].includes(raw.publicationState)) {
        // An invalid/foreign queue result cannot authorize even an error write.
        report.failed++;report.lastFailureCode = "invalid_source";break;
      }
      const claim = snapshot(raw);report.claimed++;
      if (this.stopping || !this.enabledFor(merchantId)) { report.deferred++;break; }
      if (!await this.process(claim, report)) break;
    }
    return Object.freeze(report);
  }

  private async process(claim: Readonly<PublicIndexClaim>, report: PublicIndexReport): Promise<boolean> {
    let failure: PublicIndexFailure = "canonical_unavailable", graphInFlight: Promise<void> | undefined, graphApplied = false;
    try {
      if (!claim.sourceVersion.startsWith("public-v1:")) {
        const result = await this.queue.normalizeMarker(claim);
        if (result === "normalized") report.normalized++;else report.leaseLost++;
        return true;
      }
      let sequence: number;
      try { sequence = publicWorkSequence(claim.sourceVersion); } catch { throw new PublicIndexFailureError("invalid_source"); }
      const loaded = await this.queue.loadSnapshot(claim);
      if (loaded.status !== "ready") { if (loaded.status === "superseded") report.superseded++;else report.leaseLost++;return true; }
      const source = snapshot(loaded.source);
      if (source.merchantId !== claim.merchantId || source.sourceType !== claim.sourceType || source.sourceId !== claim.sourceId
        || source.sourceHash !== claim.sourceHash || source.publicationState !== claim.publicationState) throw new PublicIndexFailureError("invalid_source");
      if (this.stopping || !this.enabledFor(claim.merchantId)) { report.deferred++;return false; }
      failure = "embedding_unavailable";
      const preparation = await this.projections.prepare(source, claim.sourceVersion);
      if (preparation.status !== "prepared") throw new PublicIndexFailureError(preparation.reason === "embedding_unavailable" ? "embedding_unavailable" : "invalid_source");
      const prepared = snapshot(preparation.projection);
      if (prepared.merchantId !== claim.merchantId || prepared.sourceType !== claim.sourceType || prepared.sourceId !== claim.sourceId
        || prepared.sourceHash !== claim.sourceHash || prepared.publicRevision !== sequence || !validId(prepared.modelId)
        || !Number.isSafeInteger(prepared.dimensions) || prepared.dimensions < 1
        || prepared.active !== (source.publicationState === "published" && Boolean(source.text.trim()))) throw new PublicIndexFailureError("invalid_source");
      if (this.stopping || !this.enabledFor(claim.merchantId)) { report.deferred++;return false; }
      failure = "canonical_unavailable";
      const committed = await this.admission.commit(claim, source, prepared, () => {
        if (graphInFlight) throw new PublicIndexFailureError("canonical_unavailable");
        graphInFlight = this.projections.submit(prepared).then(result => {
          if (result.status !== "applied") throw new PublicIndexFailureError("graph_unavailable");
          graphApplied = true;
        }, () => { throw new PublicIndexFailureError("graph_unavailable"); });
        // A port must await this promise; handle rejection immediately as well
        // so an adapter failure cannot detach graph work during stop/drain.
        graphInFlight.catch(() => {});return graphInFlight;
      });
      if (graphInFlight) await graphInFlight;
      if (committed === "lease_lost") report.leaseLost++;
      else if (committed === "superseded") report.superseded++;
      else if (committed === "completed" && graphApplied) report.completed++;
      else throw new PublicIndexFailureError("canonical_unavailable");
      return true;
    } catch (error) {
      if (graphInFlight) { try { await graphInFlight; } catch (graphError) { error = graphError; } }
      const code = error instanceof PublicIndexFailureError ? error.code : failure;
      report.lastFailureCode = code;
      try { if (await this.queue.failConditional(claim, code)) report.failed++;else report.leaseLost++; }
      catch { report.failed++;return false; }
      return true;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled(this.running.values());
  }
}
