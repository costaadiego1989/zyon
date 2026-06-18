import { Module } from "@nestjs/common";
import { EmbedModule } from "../embed/embed.module.js";
import { PRICE_QUOTE_JOB_REPOSITORY } from "./domain/ports/price-quote-job-repository.port.js";
import { InMemoryPriceQuoteJobRepository } from "./infrastructure/repositories/in-memory-price-quote-job.repository.js";
import { FlatRateSourceAdapter } from "./infrastructure/adapters/flat-rate-source.adapter.js";
import { RequestPriceQuoteUseCase } from "./application/use-cases/request-price-quote.use-case.js";
import { IngestQuoteFromSourceUseCase } from "./application/use-cases/ingest-quote-from-source.use-case.js";
import { FinalizeQuoteJobUseCase } from "./application/use-cases/finalize-quote-job.use-case.js";
import { CancelQuoteJobUseCase } from "./application/use-cases/cancel-quote-job.use-case.js";
import { WidgetPriceQuoteController } from "./presentation/http/widget-price-quote.controller.js";

// P1 infra note: InMemoryPriceQuoteJobRepository is still wired as the runtime repository.
// CLAUDE.md requires Prisma as the only runtime persistence; in-memory is for test doubles only.
// Unblocked once Prisma repos for scraping-agent are implemented (ADR 0004 work).

@Module({
  // P1 fix: import EmbedModule so EmbedAuthGuard and EmbedTokenService are available
  // for the WidgetPriceQuoteController guard wiring.
  imports: [EmbedModule],
  controllers: [WidgetPriceQuoteController],
  providers: [
    InMemoryPriceQuoteJobRepository,
    { provide: PRICE_QUOTE_JOB_REPOSITORY, useExisting: InMemoryPriceQuoteJobRepository },
    FlatRateSourceAdapter,
    RequestPriceQuoteUseCase,
    IngestQuoteFromSourceUseCase,
    FinalizeQuoteJobUseCase,
    CancelQuoteJobUseCase
  ],
  exports: [RequestPriceQuoteUseCase, IngestQuoteFromSourceUseCase]
})
export class ScrapingAgentModule {}
