import { Inject, Injectable } from "@nestjs/common";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";
import { toEndpointPublic } from "./webhook.helpers.js";

@Injectable()
export class ListWebhookEndpointsUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(merchantId: string) {
    return (await this.repo.listWebhookEndpoints(merchantId)).map((endpoint) => toEndpointPublic(endpoint));
  }
}
