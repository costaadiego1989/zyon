import { Injectable } from "@nestjs/common";
import { PriceQuoteJobEntity } from "../../domain/entities/price-quote-job.entity.js";
import type { PriceQuoteJobRepository } from "../../domain/ports/price-quote-job-repository.port.js";

@Injectable()
export class InMemoryPriceQuoteJobRepository implements PriceQuoteJobRepository {
  private readonly store = new Map<string, PriceQuoteJobEntity>();

  async save(job: PriceQuoteJobEntity): Promise<void> {
    this.store.set(job.id, job);
  }

  async findById(id: string, merchantId: string): Promise<PriceQuoteJobEntity | null> {
    const j = this.store.get(id);
    if (!j || j.merchant_id !== merchantId) return null;
    return j;
  }

  async findBySession(sessionId: string, merchantId: string): Promise<PriceQuoteJobEntity[]> {
    return [...this.store.values()].filter(
      (j) => j.snapshot().session_id === sessionId && j.merchant_id === merchantId
    );
  }
}
