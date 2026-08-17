import { Inject, Injectable , Logger} from "@nestjs/common";
import type { SupportSettings } from "@zyon/shared-types";
import { SupportSettingsEntity } from "../domain/entities/support-settings.entity.js";
import {
  SUPPORT_SETTINGS_REPOSITORY,
  type SupportSettingsRepository,
} from "../domain/ports/support-settings-repository.port.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class GetSupportSettingsUseCase {
  private readonly logger = new Logger(GetSupportSettingsUseCase.name);

  constructor(
    @Inject(SUPPORT_SETTINGS_REPOSITORY)
    private readonly repository: SupportSettingsRepository,
  ) {}

  async execute(merchantId: string): Promise<SupportSettings> {
    const existing = await this.repository.get(merchantId);
    if (existing) return existing;
    // Bug P1 fix: return in-memory default WITHOUT persisting it.
    // Write-on-read was creating garbage rows under attacker-supplied merchant_ids;
    // settings are only persisted via authenticated PUT /support/settings.
    return SupportSettingsEntity.createDefault(merchantId).snapshot();
  }
}
