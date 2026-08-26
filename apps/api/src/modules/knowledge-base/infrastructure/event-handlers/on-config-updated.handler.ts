import { Injectable, Inject, Logger, Optional, OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { IndexConfigUseCase } from "../../application/use-cases/index-config.use-case.js";

/**
 * Listens to "merchant.config_updated" events and indexes merchant configuration.
 * Called when merchant rules (payment methods, shipping regions) are updated.
 */
@Injectable()
export class OnConfigUpdatedHandler implements OnModuleInit {
  private readonly logger = new Logger(OnConfigUpdatedHandler.name);

  constructor(
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus | undefined,
    private readonly indexConfigUseCase: IndexConfigUseCase,
  ) {}

  onModuleInit() {
    this.eventBus?.subscribe(
      "merchant.config_updated",
      async (event) => {
        await this.handle(event.merchantId, event.payload);
      },
      "knowledge-base:merchant.config_updated",
    );
  }

  async handle(merchantId: string, payload: unknown): Promise<void> {
    const data = payload as
      | {
          paymentMethods?: string[];
          deliveryRegions?: string[];
          installments?: string[];
        }
      | undefined;

    if (!data) return;

    try {
      await this.indexConfigUseCase.execute({
        merchantId,
        paymentMethods: data.paymentMethods,
        deliveryRegions: data.deliveryRegions,
        installments: data.installments,
      });

      this.logger.debug(`Indexed merchant config for merchant ${merchantId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to index config for merchant ${merchantId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
