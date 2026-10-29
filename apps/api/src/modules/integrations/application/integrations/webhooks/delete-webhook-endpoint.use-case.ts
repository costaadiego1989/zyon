import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";

@Injectable()
export class DeleteWebhookEndpointUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY)
    private readonly repo: IntegrationsRepository,
  ) {}

  async execute(merchantId: string, endpointId: string): Promise<void> {
    const endpoint = await this.repo.getWebhookEndpoint(merchantId, endpointId);
    if (!endpoint) throw new NotFoundException("webhook_endpoint_not_found");
    const deleted = await this.repo.deleteWebhookEndpoint(merchantId, endpointId);
    if (!deleted) throw new NotFoundException("webhook_endpoint_not_found");
  }
}
