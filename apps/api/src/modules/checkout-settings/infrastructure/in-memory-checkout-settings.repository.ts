import { Injectable } from "@nestjs/common";
import type { CheckoutSettings } from "@aacp/shared-types";
import type { CheckoutSettingsRepository } from "../domain/ports/checkout-settings-repository.port.js";
import { OptimisticConcurrencyError } from "../../../shared/http/http-contract.errors.js";

@Injectable()
export class InMemoryCheckoutSettingsRepository implements CheckoutSettingsRepository {
  private settings = new Map<string, CheckoutSettings>();

  async get(merchantId: string): Promise<CheckoutSettings | undefined> {
    return this.settings.get(merchantId);
  }

  async save(
    settings: CheckoutSettings,
    expectedUpdatedAt?: string,
  ): Promise<CheckoutSettings> {
    const current = this.settings.get(settings.merchantId);
    if (expectedUpdatedAt && current?.updatedAt !== expectedUpdatedAt) {
      throw new OptimisticConcurrencyError();
    }
    this.settings.set(settings.merchantId, settings);
    return settings;
  }

  async delete(merchantId: string): Promise<void> {
    this.settings.delete(merchantId);
  }
}
