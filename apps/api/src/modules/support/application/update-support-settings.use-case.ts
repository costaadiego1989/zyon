import { Inject, Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { SupportSettings, SupportSettingsPatch } from "@zyon/shared-types";
import { SupportSettingsEntity } from "../domain/entities/support-settings.entity.js";
import {
  SUPPORT_SETTINGS_REPOSITORY,
  type SupportSettingsRepository,
} from "../domain/ports/support-settings-repository.port.js";

@Injectable()
export class UpdateSupportSettingsUseCase {
  constructor(
    @Inject(SUPPORT_SETTINGS_REPOSITORY)
    private readonly repository: SupportSettingsRepository,
  ) {}

  async execute(merchantId: string, patch: SupportSettingsPatch): Promise<SupportSettings> {
    const current =
      (await this.repository.get(merchantId)) ??
      SupportSettingsEntity.createDefault(merchantId).snapshot();
    try {
      const updated = SupportSettingsEntity.rehydrate(current).update(patch);
      return this.repository.save(updated.snapshot());
    } catch (err) {
      if (err instanceof Error && err.message === "support_settings_invalid_faq_items") {
        throw new UnprocessableEntityException("support_settings_invalid_faq_items");
      }
      throw err;
    }
  }
}
