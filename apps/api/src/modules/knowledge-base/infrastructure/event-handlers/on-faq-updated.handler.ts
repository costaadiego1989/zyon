import { Injectable, Inject, Logger, Optional, OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { IndexFaqUseCase } from "../../application/use-cases/index-faq.use-case.js";

/**
 * Listens to "support.faq_updated" events and indexes FAQ into knowledge base.
 * Called when support FAQ settings are updated.
 */
@Injectable()
export class OnFaqUpdatedHandler implements OnModuleInit {
  private readonly logger = new Logger(OnFaqUpdatedHandler.name);

  constructor(
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus | undefined,
    private readonly indexFaqUseCase: IndexFaqUseCase,
  ) {}

  onModuleInit() {
    this.eventBus?.subscribe("support.faq_updated", async (event) => {
      await this.handle(event.merchantId, event.payload);
    }, "knowledge-base:support.faq_updated");
  }

  async handle(merchantId: string, payload: unknown): Promise<void> {
    const data = payload as { faqItems?: any[] } | undefined;
    if (!data?.faqItems) return;

    try {
      await this.indexFaqUseCase.execute({
        merchantId,
        faqItems: data.faqItems,
      });

      this.logger.debug(`Indexed ${data.faqItems.length} FAQ items for merchant ${merchantId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to index FAQ for merchant ${merchantId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
