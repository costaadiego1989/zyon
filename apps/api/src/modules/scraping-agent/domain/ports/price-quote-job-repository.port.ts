import type { PriceQuoteJobEntity } from "../entities/price-quote-job.entity.js";

export const PRICE_QUOTE_JOB_REPOSITORY = Symbol("PRICE_QUOTE_JOB_REPOSITORY");

export interface PriceQuoteJobRepository {
  save(job: PriceQuoteJobEntity): Promise<void>;
  findById(id: string, merchantId: string): Promise<PriceQuoteJobEntity | null>;
  findBySession(sessionId: string, merchantId: string): Promise<PriceQuoteJobEntity[]>;
}
