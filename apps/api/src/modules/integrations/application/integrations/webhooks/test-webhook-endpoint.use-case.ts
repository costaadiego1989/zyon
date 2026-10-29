import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { MerchantWebhookDeliveryPublic } from "../../../domain/integrations.types.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";
import { toDeliveryPublic } from "./webhook.helpers.js";
import { TenantWebhookPublisher } from "./tenant-webhook-publisher.js";

@Injectable()
export class TestWebhookEndpointUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository,
    private readonly publisher: TenantWebhookPublisher
  ) {}

  async execute(merchantId: string, endpointId: string): Promise<MerchantWebhookDeliveryPublic> {
    const endpoint = await this.repo.getWebhookEndpoint(merchantId, endpointId);
    if (!endpoint) throw new NotFoundException("webhook_endpoint_not_found");
    const deliveries = await this.publisher.publish({
      merchantId,
      eventType: "order.approved",
      data: {
        test: true,
        order: { external_order_id: "test-order", status: "approved" }
      }
    });
    const delivery = deliveries.find((candidate) => candidate.endpointId === endpointId);
    if (!delivery) throw new BadRequestException("webhook_event_not_enabled_for_endpoint");
    return toDeliveryPublic(delivery);
  }
}
