import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import { PriceQuoteJobEntity } from "../../domain/entities/price-quote-job.entity.js";
import { PRICE_QUOTE_JOB_REPOSITORY, type PriceQuoteJobRepository } from "../../domain/ports/price-quote-job-repository.port.js";
import { filterAllowedSources } from "../../domain/policies/source-allow-list.policy.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createScrapingEventEnvelope } from "../../domain/events/scraping-domain-event.js";

const DEFAULT_ALLOWED_SOURCES = ["mercado-livre", "amazon-br", "buscape", "flat-rate"];

@Injectable()
export class RequestPriceQuoteUseCase {
  constructor(
    @Inject(PRICE_QUOTE_JOB_REPOSITORY) private readonly repo: PriceQuoteJobRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: {
    session_id: string;
    merchant_id: string;
    buyer_global_user_id?: string;
    raw_query: string;
    sources?: string[];
  }) {
    const allowedSources = DEFAULT_ALLOWED_SOURCES;
    const requested = input.sources?.length
      ? filterAllowedSources(input.sources, allowedSources)
      : allowedSources;

    if (requested.length === 0) throw new BadRequestException("SOURCE_NOT_ALLOWED");

    const job = PriceQuoteJobEntity.create({
      session_id: input.session_id,
      merchant_id: input.merchant_id,
      buyer_global_user_id: input.buyer_global_user_id,
      raw_query: input.raw_query,
      requested_sources: requested
    });

    await this.repo.save(job);

    await this.outbox.appendOutbox(
      createScrapingEventEnvelope({
        eventType: "scraping.job.requested",
        merchantId: input.merchant_id,
        payload: {
          job_id: job.id,
          session_id: input.session_id,
          merchant_id: input.merchant_id,
          raw_query: input.raw_query,
          requested_sources: requested
        }
      })
    );

    return job.snapshot();
  }
}
