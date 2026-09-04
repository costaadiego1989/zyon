import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AcpOrderEventType,
  AcpWebhookSubscriptionCreated,
  AcpWebhookSubscriptionPublic,
} from "../acp-webhook-event.types.js";
import { isAcpOrderEventType } from "../acp-webhook-event.types.js";
import {
  AcpWebhookSubscriptionEntity,
} from "../domain/acp-webhook-subscription.entity.js";
import {
  ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY,
  type AcpWebhookSubscriptionRepository,
} from "../domain/acp-webhook-subscription.repository.port.js";
import { AcpWebhookDispatcherService } from "./acp-webhook-dispatcher.service.js";

export interface RegisterSubscriptionInput {
  merchantId: string;
  url: string;
  events: AcpOrderEventType[];
}

@Injectable()
export class RegisterAcpWebhookSubscriptionUseCase {
  constructor(
    @Inject(ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: AcpWebhookSubscriptionRepository,
    private readonly dispatcher: AcpWebhookDispatcherService,
  ) {}

  async execute(input: RegisterSubscriptionInput): Promise<AcpWebhookSubscriptionCreated> {
    const merchantId = requiredMerchant(input.merchantId);
    const url = requiredUrl(input.url);
    const events = normalizeEvents(input.events);

    const { entity, plaintextSecret } = AcpWebhookSubscriptionEntity.register({
      merchantId,
      url,
      events,
    });

    await this.subscriptions.save(entity);
    this.dispatcher.registerSubscriptionSecret(plaintextSecret);

    return entity.toCreated(plaintextSecret);
  }
}

@Injectable()
export class ListAcpWebhookSubscriptionsUseCase {
  constructor(
    @Inject(ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: AcpWebhookSubscriptionRepository,
  ) {}

  async execute(merchantId: string): Promise<AcpWebhookSubscriptionPublic[]> {
    const resolved = requiredMerchant(merchantId);
    const records = await this.subscriptions.listByMerchant(resolved);
    return records.map((record) => record.toPublic());
  }
}

@Injectable()
export class DeleteAcpWebhookSubscriptionUseCase {
  constructor(
    @Inject(ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: AcpWebhookSubscriptionRepository,
  ) {}

  async execute(input: { merchantId: string; id: string }): Promise<void> {
    const merchantId = requiredMerchant(input.merchantId);
    const id = requiredId(input.id);
    const existing = await this.subscriptions.findById(merchantId, id);
    if (!existing) throw new NotFoundException("acp_webhook_subscription_not_found");
    const removed = await this.subscriptions.delete(merchantId, id);
    if (!removed) throw new NotFoundException("acp_webhook_subscription_not_found");
  }
}

@Injectable()
export class PublishAcpOrderEventUseCase {
  constructor(private readonly dispatcher: AcpWebhookDispatcherService) {}

  async execute(input: {
    merchantId: string;
    eventType: AcpOrderEventType;
    data: import("../acp-webhook-event.types.js").AcpOrderEventData;
  }) {
    return this.dispatcher.publish({
      merchantId: requiredMerchant(input.merchantId),
      eventType: input.eventType,
      data: input.data,
    });
  }
}

function requiredMerchant(value: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new BadRequestException("merchant_id_required");
  return trimmed;
}

function requiredId(value: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new BadRequestException("subscription_id_required");
  return trimmed;
}

function requiredUrl(raw: string): string {
  const trimmed = raw?.trim();
  if (!trimmed) throw new BadRequestException("acp_webhook_url_required");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BadRequestException("acp_webhook_url_invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BadRequestException("acp_webhook_protocol_unsupported");
  }
  return trimmed;
}

function normalizeEvents(events: readonly unknown[]): AcpOrderEventType[] {
  if (!Array.isArray(events) || events.length === 0) {
    throw new BadRequestException("acp_webhook_events_required");
  }
  const normalized: AcpOrderEventType[] = [];
  for (const raw of events) {
    if (!isAcpOrderEventType(raw)) {
      throw new BadRequestException(`acp_webhook_event_invalid:${String(raw)}`);
    }
    if (!normalized.includes(raw)) normalized.push(raw);
  }
  if (normalized.length === 0) {
    throw new BadRequestException("acp_webhook_events_required");
  }
  return normalized;
}
