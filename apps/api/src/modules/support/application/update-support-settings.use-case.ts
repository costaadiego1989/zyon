import { Inject, Injectable, UnprocessableEntityException , Logger, Optional} from "@nestjs/common";
import type { SupportSettings, SupportSettingsPatch } from "@zyon/shared-types";
import { SupportSettingsEntity } from "../domain/entities/support-settings.entity.js";
import {
  SUPPORT_SETTINGS_REPOSITORY,
  type SupportSettingsRepository,
} from "../domain/ports/support-settings-repository.port.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";

@Injectable()
export class UpdateSupportSettingsUseCase {
  private readonly logger = new Logger(UpdateSupportSettingsUseCase.name);

  constructor(
    @Inject(SUPPORT_SETTINGS_REPOSITORY)
    private readonly repository: SupportSettingsRepository,
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus?: DomainEventBus,
  ) {}

  async execute(merchantId: string, patch: SupportSettingsPatch): Promise<SupportSettings> {
    const current =
      (await this.repository.get(merchantId)) ??
      SupportSettingsEntity.createDefault(merchantId).snapshot();
    try {
      const updated = SupportSettingsEntity.rehydrate(current).update(patch);
      const result = await this.repository.save(updated.snapshot());

      // Emit FAQ update event if FAQ items changed
      if (patch.faqItems) {
        this.eventBus?.publish({
          eventType: "support.faq_updated",
          merchantId,
          payload: {
            faqItems: patch.faqItems,
          },
        });
      }

      return result;
    } catch (err) {
      if (err instanceof Error && err.message === "support_settings_invalid_faq_items") {
        throw new UnprocessableEntityException("support_settings_invalid_faq_items");
      }
      throw err;
    }
  }
}
