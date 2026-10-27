import { Injectable, Inject, BadRequestException , Logger} from "@nestjs/common";
import { PriceQuoteJobEntity } from "../../domain/entities/price-quote-job.entity.js";
import { PRICE_QUOTE_JOB_REPOSITORY, type PriceQuoteJobRepository } from "../../domain/ports/price-quote-job-repository.port.js";
import { filterAllowedSources } from "../../domain/policies/source-allow-list.policy.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createScrapingEventEnvelope } from "../../domain/events/scraping-domain-event.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

/**
 * Platform-level fallback allowlist used when the merchant has not configured a custom list.
 * The real fix (P2) passes `merchant_allowed_sources` from the merchant's configuration at
 * the call site; this constant serves as the safe default until merchant config is wired.
 */
const PLATFORM_DEFAULT_ALLOWED_SOURCES = ["mercado-livre", "amazon-br", "buscape", "flat-rate"];

/** Max raw_query length to prevent unbounded input. */
const MAX_RAW_QUERY_LENGTH = 500;

@Injectable()
export class RequestPriceQuoteUseCase {
  private readonly logger = new Logger(RequestPriceQuoteUseCase.name);

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
    /**
     * P2 fix: merchant-specific allowed sources list, loaded by the caller from merchant config.
     * Falls back to PLATFORM_DEFAULT_ALLOWED_SOURCES when not provided.
     */
    merchant_allowed_sources?: string[];
  }) {
    // P2 fix: validate raw_query bounds.
    if (!input.raw_query.trim()) throw new BadRequestException("raw_query_required");
    if (input.raw_query.trim().length > MAX_RAW_QUERY_LENGTH) {
      throw new BadRequestException("raw_query_too_long");
    }

    // P2 fix: use merchant-configured allowlist instead of hardcoded constant.
    const allowedSources = input.merchant_allowed_sources?.length
      ? input.merchant_allowed_sources
      : PLATFORM_DEFAULT_ALLOWED_SOURCES;

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

    // P1 note: save + appendOutbox are two separate awaits.
    // Full atomicity requires a Prisma transactional outbox (ADR 0003).
    // Blocked until Prisma repos are wired (ADR 0004).
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
