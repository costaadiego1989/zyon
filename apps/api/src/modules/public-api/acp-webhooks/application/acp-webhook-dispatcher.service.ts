import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import type {
  AcpOrderEventData,
  AcpOrderEventEnvelope,
  AcpOrderEventType,
} from "../acp-webhook-event.types.js";
import { hashSecret } from "../domain/acp-webhook-subscription.entity.js";
import {
  ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY,
  type AcpWebhookSubscriptionRepository,
} from "../domain/acp-webhook-subscription.repository.port.js";

export const ACP_WEBHOOK_HTTP_FETCHER = Symbol("ACP_WEBHOOK_HTTP_FETCHER");

export interface AcpWebhookHttpResponse {
  status: number;
  ok: boolean;
  body: string;
}

export type AcpWebhookHttpFetcher = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<AcpWebhookHttpResponse>;

export const ACP_WEBHOOK_DISPATCHER_CONFIG = Symbol(
  "ACP_WEBHOOK_DISPATCHER_CONFIG",
);

export interface AcpWebhookDispatcherConfig {
  timeoutMs: number;
  maxAttempts: number;
  backoffMs: readonly number[];
  retryQueueCapacity: number;
  enabled: boolean;
}

export interface AcpPublishOptions {
  skipHttp?: boolean;
}

export interface AcpPublishResult {
  eventId: string;
  enqueuedDeliveries: number;
  attempts: number;
  failedDeliveries: number;
}

const DEFAULT_CONFIG: AcpWebhookDispatcherConfig = {
  timeoutMs: 10_000,
  maxAttempts: 3,
  backoffMs: [1_000, 5_000, 25_000],
  retryQueueCapacity: 1024,
  enabled: true,
};

export interface QueuedDelivery {
  subscriptionId: string;
  url: string;
  secretHash: string;
  envelope: AcpOrderEventEnvelope;
  attempts: number;
  nextAttemptAt: number;
}

export interface AcpWebhookDeliveryRecord {
  eventId: string;
  subscriptionId: string;
  url: string;
  attempts: number;
  status: "delivered" | "failed";
  responseStatus?: number;
  responseBody?: string;
  error?: string;
}

const SIGNATURE_HEADER = "X-AACP-Signature";
const EVENT_ID_HEADER = "X-AACP-Event-Id";
const EVENT_TYPE_HEADER = "X-AACP-Event-Type";
const TIMESTAMP_HEADER = "X-AACP-Timestamp";

@Injectable()
export class AcpWebhookDispatcherService {
  private readonly logger = new Logger(AcpWebhookDispatcherService.name);
  private readonly deliveries: AcpWebhookDeliveryRecord[] = [];
  private readonly retryQueue: QueuedDelivery[] = [];
  private readonly secretsByHash = new Map<string, string>();
  private readonly inFlightTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly currentConfig: AcpWebhookDispatcherConfig;

  constructor(
    @Inject(ACP_WEBHOOK_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: AcpWebhookSubscriptionRepository,
    @Optional()
    @Inject(ACP_WEBHOOK_HTTP_FETCHER)
    private readonly fetcher: AcpWebhookHttpFetcher = defaultFetcher,
    @Optional()
    @Inject(ACP_WEBHOOK_DISPATCHER_CONFIG)
    config?: Partial<AcpWebhookDispatcherConfig>,
  ) {
    this.currentConfig = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  }

  getConfig(): AcpWebhookDispatcherConfig {
    return { ...this.currentConfig };
  }

  registerSubscriptionSecret(plaintextSecret: string): string {
    const secretHash = hashSecret(plaintextSecret);
    this.secretsByHash.set(secretHash, plaintextSecret);
    return secretHash;
  }

  async publish(
    input: {
      merchantId: string;
      eventType: AcpOrderEventType;
      data: AcpOrderEventData;
      now?: string;
    },
    options: AcpPublishOptions = {},
  ): Promise<AcpPublishResult> {
    if (!this.currentConfig.enabled) {
      return { eventId: "", enqueuedDeliveries: 0, attempts: 0, failedDeliveries: 0 };
    }

    const createdAt = input.now ?? new Date().toISOString();
    const envelope: AcpOrderEventEnvelope = {
      id: `evt_${randomUUID()}`,
      type: input.eventType,
      created_at: createdAt,
      merchant_id: input.merchantId,
      data: input.data,
    };

    const subscriptions = await this.subscriptions.listByMerchant(input.merchantId);
    const matching = subscriptions.filter((s) => s.events.includes(input.eventType));

    if (matching.length === 0) {
      return {
        eventId: envelope.id,
        enqueuedDeliveries: 0,
        attempts: 0,
        failedDeliveries: 0,
      };
    }

    let enqueued = 0;
    let failed = 0;

    for (const subscription of matching) {
      const secret = this.secretsByHash.get(subscription.secretHash);
      if (!secret) {
        this.logger.warn(
          `acp-webhook: no plaintext secret cached for subscription=${subscription.id}; skipping`,
        );
        failed += 1;
        continue;
      }

      if (options.skipHttp) {
        this.deliveries.push({
          eventId: envelope.id,
          subscriptionId: subscription.id,
          url: subscription.url,
          attempts: 0,
          status: "delivered",
        });
        enqueued += 1;
        continue;
      }

      const queued: QueuedDelivery = {
        subscriptionId: subscription.id,
        url: subscription.url,
        secretHash: subscription.secretHash,
        envelope,
        attempts: 0,
        nextAttemptAt: Date.now(),
      };

      this.scheduleDelivery(queued, secret);
      enqueued += 1;
    }

    return {
      eventId: envelope.id,
      enqueuedDeliveries: enqueued,
      attempts: 0,
      failedDeliveries: failed,
    };
  }

  listDeliveries(): readonly AcpWebhookDeliveryRecord[] {
    return [...this.deliveries];
  }

  clearDeliveries(): void {
    this.deliveries.length = 0;
    this.retryQueue.length = 0;
    this.secretsByHash.clear();
    for (const timer of this.inFlightTimers) clearTimeout(timer);
    this.inFlightTimers.clear();
  }

  sign(input: { secret: string; timestamp: string; body: string }): string {
    return signPayload(input);
  }

  buildRequest(input: {
    secret: string;
    envelope: AcpOrderEventEnvelope;
  }): { url: string; body: string; headers: Record<string, string>; timestamp: string } {
    const body = JSON.stringify(input.envelope);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.sign({ secret: input.secret, timestamp, body });
    return {
      url: "[managed by dispatcher]",
      body,
      timestamp,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "AACP-Webhooks/1.0",
        [SIGNATURE_HEADER]: `sha256=${signature}`,
        [TIMESTAMP_HEADER]: timestamp,
        [EVENT_ID_HEADER]: input.envelope.id,
        [EVENT_TYPE_HEADER]: input.envelope.type,
      },
    };
  }

  private scheduleDelivery(delivery: QueuedDelivery, secret: string): void {
    const execute = (): void => {
      this.inFlightTimers.delete(timer);
      void this.attemptDelivery(delivery, secret);
    };
    const delay = Math.max(0, delivery.nextAttemptAt - Date.now());
    const timer = setTimeout(execute, delay);
    this.inFlightTimers.add(timer);
  }

  private async attemptDelivery(
    delivery: QueuedDelivery,
    secret: string,
  ): Promise<void> {
    const body = JSON.stringify(delivery.envelope);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signPayload({ secret, timestamp, body });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "AACP-Webhooks/1.0",
      [SIGNATURE_HEADER]: `sha256=${signature}`,
      [TIMESTAMP_HEADER]: timestamp,
      [EVENT_ID_HEADER]: delivery.envelope.id,
      [EVENT_TYPE_HEADER]: delivery.envelope.type,
    };

    let response: AcpWebhookHttpResponse;
    try {
      response = await this.fetcher(delivery.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(this.currentConfig.timeoutMs),
      });
    } catch (error) {
      await this.retryOrRecordFailure(delivery, secret, undefined, "", errorMessage(error));
      return;
    }

    if (response.ok) {
      this.deliveries.push({
        eventId: delivery.envelope.id,
        subscriptionId: delivery.subscriptionId,
        url: delivery.url,
        attempts: delivery.attempts + 1,
        status: "delivered",
        responseStatus: response.status,
        responseBody: response.body.slice(0, 500),
      });
      return;
    }

    const retryable = isRetryableStatus(response.status);
    if (!retryable) {
      this.deliveries.push({
        eventId: delivery.envelope.id,
        subscriptionId: delivery.subscriptionId,
        url: delivery.url,
        attempts: delivery.attempts + 1,
        status: "failed",
        responseStatus: response.status,
        responseBody: response.body.slice(0, 500),
        error: `http_${response.status}_non_retryable`,
      });
      return;
    }

    await this.retryOrRecordFailure(
      delivery,
      secret,
      response.status,
      response.body,
      `http_${response.status}`,
    );
  }

  private async retryOrRecordFailure(
    delivery: QueuedDelivery,
    secret: string,
    status: number | undefined,
    responseBody: string,
    errorLabel: string,
  ): Promise<void> {
    const attempts = delivery.attempts + 1;
    if (attempts >= this.currentConfig.maxAttempts) {
      this.deliveries.push({
        eventId: delivery.envelope.id,
        subscriptionId: delivery.subscriptionId,
        url: delivery.url,
        attempts,
        status: "failed",
        responseStatus: status,
        responseBody: responseBody.slice(0, 500),
        error: errorLabel,
      });
      return;
    }

    const delayIndex = Math.min(attempts - 1, this.currentConfig.backoffMs.length - 1);
    const delay = this.currentConfig.backoffMs[delayIndex] ?? 25_000;
    const queued: QueuedDelivery = {
      ...delivery,
      attempts,
      nextAttemptAt: Date.now() + delay,
    };
    if (this.retryQueue.length >= this.currentConfig.retryQueueCapacity) {
      this.deliveries.push({
        eventId: delivery.envelope.id,
        subscriptionId: delivery.subscriptionId,
        url: delivery.url,
        attempts,
        status: "failed",
        error: "retry_queue_full",
      });
      return;
    }
    this.retryQueue.push(queued);
    this.scheduleDelivery(queued, secret);
  }
}

export function signPayload(input: {
  secret: string;
  timestamp: string;
  body: string;
}): string {
  return createHmac("sha256", input.secret).update(input.body).digest("hex");
}

function isRetryableStatus(status: number): boolean {
  if (status >= 500) return true;
  if (status === 408 || status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return false;
}

const defaultFetcher: AcpWebhookHttpFetcher = async (url, init) => {
  const res = await fetch(url, init as unknown as RequestInit);
  let body = "";
  try {
    body = await res.text();
  } catch {
    body = "";
  }
  return { status: res.status, ok: res.ok, body };
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
