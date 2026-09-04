import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { MerchantWebhookDeliveryPublic } from "../../../domain/integrations.types.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";
import { toDeliveryPublic } from "./webhook.helpers.js";

@Injectable()
export class ReplayWebhookDeliveryUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(merchantId: string, deliveryId: string): Promise<MerchantWebhookDeliveryPublic> {
    const delivery = await this.repo.getWebhookDelivery(merchantId, deliveryId);
    if (!delivery) throw new NotFoundException("webhook_delivery_not_found");
    const now = new Date().toISOString();
    return toDeliveryPublic(await this.repo.updateWebhookDelivery({
      ...delivery,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      responseStatus: undefined,
      responseBody: undefined,
      error: undefined,
      deliveredAt: undefined,
      updatedAt: now
    }));
  }
}
