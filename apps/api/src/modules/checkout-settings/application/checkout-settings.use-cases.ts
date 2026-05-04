import { Inject, Injectable } from "@nestjs/common";
import type { CheckoutSettings, CheckoutSettingsContext, CheckoutSettingsPatch } from "@aacp/shared-types";
import { CheckoutSettingsEntity } from "../domain/entities/checkout-settings.entity.js";
import {
  CHECKOUT_SETTINGS_REPOSITORY,
  type CheckoutSettingsRepository
} from "../domain/ports/checkout-settings-repository.port.js";

@Injectable()
export class GetCheckoutSettingsUseCase {
  constructor(@Inject(CHECKOUT_SETTINGS_REPOSITORY) private readonly repository: CheckoutSettingsRepository) {}

  async execute(merchantId: string): Promise<CheckoutSettings> {
    const existing = await this.repository.get(merchantId);
    if (existing) return existing;
    return this.repository.save(CheckoutSettingsEntity.createDefault({ merchantId }).snapshot());
  }
}

@Injectable()
export class UpdateCheckoutSettingsUseCase {
  constructor(@Inject(CHECKOUT_SETTINGS_REPOSITORY) private readonly repository: CheckoutSettingsRepository) {}

  async execute(merchantId: string, patch: CheckoutSettingsPatch): Promise<CheckoutSettings> {
    const current = (await this.repository.get(merchantId)) ?? CheckoutSettingsEntity.createDefault({ merchantId }).snapshot();
    return this.repository.save(CheckoutSettingsEntity.rehydrate(current).update(patch).snapshot());
  }
}

@Injectable()
export class ResetCheckoutSettingsUseCase {
  constructor(@Inject(CHECKOUT_SETTINGS_REPOSITORY) private readonly repository: CheckoutSettingsRepository) {}

  async execute(merchantId: string): Promise<CheckoutSettings> {
    await this.repository.delete(merchantId);
    return this.repository.save(CheckoutSettingsEntity.createDefault({ merchantId }).snapshot());
  }
}

@Injectable()
export class GetCheckoutSettingsContextUseCase {
  constructor(@Inject(CHECKOUT_SETTINGS_REPOSITORY) private readonly repository: CheckoutSettingsRepository) {}

  async execute(merchantId: string): Promise<CheckoutSettingsContext> {
    const settings = (await this.repository.get(merchantId)) ?? CheckoutSettingsEntity.createDefault({ merchantId }).snapshot();
    return CheckoutSettingsEntity.rehydrate(settings).toContext();
  }
}
