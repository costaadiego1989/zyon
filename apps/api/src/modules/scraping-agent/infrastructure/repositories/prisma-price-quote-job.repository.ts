import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PriceQuoteJobEntity } from "../../domain/entities/price-quote-job.entity.js";
import type { PriceQuoteJobRepository } from "../../domain/ports/price-quote-job-repository.port.js";

@Injectable()
export class PrismaPriceQuoteJobRepository implements PriceQuoteJobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(job: PriceQuoteJobEntity): Promise<void> {
    const snap = job.snapshot();
    await this.prisma.priceQuoteJob.upsert({
      where: { id: snap.id },
      update: {
        status: snap.status,
        normalizedQuery: snap.normalized_query ?? undefined,
        results: snap.results as any,
        rankedResults: snap.ranked_results,
        routingDecision: snap.routing_decision,
        startedAt: snap.started_at ? new Date(snap.started_at) : null,
        completedAt: snap.completed_at ? new Date(snap.completed_at) : null,
      },
      create: {
        id: snap.id,
        sessionId: snap.session_id,
        merchantId: snap.merchant_id,
        buyerGlobalUserId: snap.buyer_global_user_id,
        rawQuery: snap.raw_query,
        normalizedQuery: snap.normalized_query ?? undefined,
        requestedSources: snap.requested_sources,
        status: snap.status,
        results: snap.results as any,
        rankedResults: snap.ranked_results,
        routingDecision: snap.routing_decision,
        startedAt: snap.started_at ? new Date(snap.started_at) : null,
        completedAt: snap.completed_at ? new Date(snap.completed_at) : null,
        createdAt: new Date(snap.created_at),
      },
    });
  }

  async findById(id: string, merchantId: string): Promise<PriceQuoteJobEntity | null> {
    const row = await this.prisma.priceQuoteJob.findFirst({
      where: { id, merchantId },
    });
    return row ? this.toDomain(row) : null;
  }

  async findBySession(sessionId: string, merchantId: string): Promise<PriceQuoteJobEntity[]> {
    const rows = await this.prisma.priceQuoteJob.findMany({
      where: { sessionId, merchantId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDomain(r));
  }

  private toDomain(row: any): PriceQuoteJobEntity {
    return PriceQuoteJobEntity.rehydrate({
      id: row.id,
      session_id: row.sessionId,
      merchant_id: row.merchantId,
      buyer_global_user_id: row.buyerGlobalUserId,
      raw_query: row.rawQuery,
      normalized_query: row.normalizedQuery as any ?? null,
      requested_sources: row.requestedSources,
      status: row.status,
      results: (row.results ?? []) as any,
      ranked_results: row.rankedResults,
      routing_decision: row.routingDecision,
      started_at: row.startedAt?.toISOString() ?? null,
      completed_at: row.completedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
    });
  }
}
