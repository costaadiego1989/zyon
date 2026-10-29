import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";
import { toDeliveryPublic } from "./webhook.helpers.js";

@Injectable()
export class GetWebhookDeliveryUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY)
    private readonly repo: IntegrationsRepository,
  ) {}

  async execute(merchantId: string, deliveryId: string) {
    const delivery = await this.repo.getWebhookDelivery(
      merchantId,
      deliveryId,
    );
    if (!delivery) throw new NotFoundException("webhook_delivery_not_found");
    return toDeliveryPublic(delivery);
  }
}
