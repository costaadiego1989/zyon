import { Inject, Injectable } from "@nestjs/common";
import type { SupportSettings } from "@aacp/shared-types";
import { SupportSettingsEntity } from "../domain/entities/support-settings.entity.js";
import {
  SUPPORT_SETTINGS_REPOSITORY,
  type SupportSettingsRepository,
} from "../domain/ports/support-settings-repository.port.js";

@Injectable()
export class GetSupportSettingsUseCase {
  constructor(
    @Inject(SUPPORT_SETTINGS_REPOSITORY)
    private readonly repository: SupportSettingsRepository,
  ) {}

  async execute(merchantId: string): Promise<SupportSettings> {
    const existing = await this.repository.get(merchantId);
    if (existing) return existing;
    return this.repository.save(SupportSettingsEntity.createDefault(merchantId).snapshot());
  }
}
