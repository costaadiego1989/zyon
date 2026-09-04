import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import {
  type MerchantWebhookEndpoint,
  type TenantWebhookEventType,
} from "../../../domain/integrations.types.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";
import {
  WEBHOOK_TARGET_POLICY,
  type WebhookTargetPolicy,
} from "../../../domain/ports/webhook-target-policy.port.js";
import { toEndpointPublic, sanitizeWebhookEvents, validateEndpointUrl } from "./webhook.helpers.js";

@Injectable()
export class UpsertWebhookEndpointUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY)
    private readonly repo: IntegrationsRepository,
    @Optional()
    @Inject(WEBHOOK_TARGET_POLICY)
    private readonly targetPolicy?: WebhookTargetPolicy,
  ) {}

  async execute(input: {
    merchantId: string;
    endpointId?: string;
    url: string;
    events?: TenantWebhookEventType[];
    enabled?: boolean;
    description?: string;
  }) {
    const now = new Date().toISOString();
    const existing = input.endpointId ? await this.repo.getWebhookEndpoint(input.merchantId, input.endpointId) : undefined;
    if (input.endpointId && !existing) throw new NotFoundException("webhook_endpoint_not_found");
    const endpointUrl = this.targetPolicy
      ? (await this.targetPolicy.assertAllowed(input.url)).url
      : validateEndpointUrl(input.url);
    const endpoint: MerchantWebhookEndpoint = {
      id: existing?.id ?? `wh_${randomUUID()}`,
      merchantId: input.merchantId,
      url: endpointUrl,
      enabled: input.enabled ?? existing?.enabled ?? true,
      events: sanitizeWebhookEvents(input.events ?? existing?.events ?? ["order.approved", "customer.upserted", "order.tracking.updated"]),
      signingSecret: existing?.signingSecret ?? `whsec_${randomBytes(24).toString("base64url")}`,
      description: input.description ?? existing?.description,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    return toEndpointPublic(await this.repo.upsertWebhookEndpoint(endpoint), { includeSecret: true });
  }
}
