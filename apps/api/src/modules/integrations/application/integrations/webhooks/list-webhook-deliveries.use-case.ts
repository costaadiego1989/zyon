import { Inject, Injectable } from "@nestjs/common";
import type { MerchantWebhookDeliveryPublic } from "../../../domain/integrations.types.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";
import { toDeliveryPublic } from "./webhook.helpers.js";

@Injectable()
export class ListWebhookDeliveriesUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(merchantId: string, limit?: number): Promise<MerchantWebhookDeliveryPublic[]> {
    return (await this.repo.listWebhookDeliveries(merchantId, limit)).map(toDeliveryPublic);
  }
}
