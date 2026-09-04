import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";
import { toEndpointPublic } from "./webhook.helpers.js";

@Injectable()
export class RotateWebhookSigningSecretUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY)
    private readonly repo: IntegrationsRepository,
  ) {}

  async execute(merchantId: string, endpointId: string) {
    const endpoint = await this.repo.getWebhookEndpoint(
      merchantId,
      endpointId,
    );
    if (!endpoint) throw new NotFoundException("webhook_endpoint_not_found");
    const rotated = await this.repo.upsertWebhookEndpoint({
      ...endpoint,
      signingSecret: `whsec_${randomBytes(24).toString("base64url")}`,
      updatedAt: new Date().toISOString(),
    });
    return toEndpointPublic(rotated, { includeSecret: true });
  }
}
