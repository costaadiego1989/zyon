import { randomUUID } from "node:crypto";

export type QuoteJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type PriceQuoteResult = {
  id: string;
  source_key: string;
  product_title: string;
  url: string;
  price: number;
  shipping_estimate: number | null;
  total_cost: number;
  currency: "BRL";
  availability: "in_stock" | "out_of_stock" | "unknown";
  raw_snapshot: Record<string, unknown>;
  ingested_at: string;
};

export type ProductQuery = {
  normalized_name: string;
  brand: string | null;
  model: string | null;
  attributes: Record<string, string>;
};

export type PriceQuoteJobSnapshot = {
  id: string;
  session_id: string;
  merchant_id: string;
  buyer_global_user_id: string | null;
  raw_query: string;
  normalized_query: ProductQuery | null;
  requested_sources: string[];
  status: QuoteJobStatus;
  results: PriceQuoteResult[];
  ranked_results: string[];
  routing_decision: "integrated" | "external" | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export class PriceQuoteJobEntity {
  private constructor(private readonly s: PriceQuoteJobSnapshot) {}

  static create(input: {
    session_id: string;
    merchant_id: string;
    buyer_global_user_id?: string;
    raw_query: string;
    requested_sources: string[];
  }): PriceQuoteJobEntity {
    if (!input.merchant_id.trim()) throw new Error("scraping_job_merchant_required");
    if (!input.raw_query.trim()) throw new Error("scraping_job_query_required");
    if (input.requested_sources.length === 0) throw new Error("scraping_job_sources_required");
    return new PriceQuoteJobEntity({
      id: randomUUID(),
      session_id: input.session_id,
      merchant_id: input.merchant_id,
      buyer_global_user_id: input.buyer_global_user_id ?? null,
      raw_query: input.raw_query.trim(),
      normalized_query: null,
      requested_sources: input.requested_sources,
      status: "pending",
      results: [],
      ranked_results: [],
      routing_decision: null,
      started_at: null,
      completed_at: null,
      created_at: new Date().toISOString()
    });
  }

  static rehydrate(s: PriceQuoteJobSnapshot): PriceQuoteJobEntity {
    return new PriceQuoteJobEntity(s);
  }

  start(normalizedQuery: ProductQuery | null): PriceQuoteJobEntity {
    if (this.s.status !== "pending") throw new Error("illegal_transition");
    return new PriceQuoteJobEntity({
      ...this.s,
      status: "running",
      normalized_query: normalizedQuery,
      started_at: new Date().toISOString()
    });
  }

  ingestResult(result: PriceQuoteResult): PriceQuoteJobEntity {
    if (this.s.status !== "running") throw new Error("illegal_transition");
    return new PriceQuoteJobEntity({ ...this.s, results: [...this.s.results, result] });
  }

  /**
   * P2 fix: idempotent upsert — if a result with the same id already exists it is replaced
   * (not appended), preventing duplicate entries from redelivered callbacks that distort ranking.
   * Throws "illegal_transition" if the job is not in "running" status.
   */
  upsertResult(result: PriceQuoteResult): PriceQuoteJobEntity {
    if (this.s.status !== "running") throw new Error("illegal_transition");
    const existing = this.s.results.findIndex((r) => r.id === result.id);
    const results =
      existing >= 0
        ? [...this.s.results.slice(0, existing), result, ...this.s.results.slice(existing + 1)]
        : [...this.s.results, result];
    return new PriceQuoteJobEntity({ ...this.s, results });
  }

  complete(rankedIds: string[], routingDecision: "integrated" | "external"): PriceQuoteJobEntity {
    if (this.s.status !== "running") throw new Error("illegal_transition");
    return new PriceQuoteJobEntity({
      ...this.s,
      status: "completed",
      ranked_results: rankedIds,
      routing_decision: routingDecision,
      completed_at: new Date().toISOString()
    });
  }

  fail(): PriceQuoteJobEntity {
    return new PriceQuoteJobEntity({ ...this.s, status: "failed", completed_at: new Date().toISOString() });
  }

  cancel(): PriceQuoteJobEntity {
    if (this.s.status === "completed" || this.s.status === "failed") throw new Error("illegal_transition");
    return new PriceQuoteJobEntity({ ...this.s, status: "cancelled", completed_at: new Date().toISOString() });
  }

  snapshot(): PriceQuoteJobSnapshot { return { ...this.s, results: [...this.s.results] }; }
  get id(): string { return this.s.id; }
  get merchant_id(): string { return this.s.merchant_id; }
  get status(): QuoteJobStatus { return this.s.status; }
}
