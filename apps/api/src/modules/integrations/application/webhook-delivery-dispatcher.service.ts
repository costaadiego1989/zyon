import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../domain/ports/integrations.repository.port.js";
import { WebhookSignatureService } from "../domain/webhook-signature.service.js";
import type { MerchantWebhookDelivery } from "../domain/integrations.types.js";

const DEFAULT_DISPATCH_INTERVAL_MS = 10_000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class WebhookDeliveryDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryDispatcher.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository,
    private readonly signatures: WebhookSignatureService
  ) {}

  onModuleInit(): void {
    if (!webhookDispatcherEnabled()) {
      this.logger.log("Webhook dispatcher disabled. Set WEBHOOK_DISPATCHER_ENABLED=true to enable it.");
      return;
    }

    this.timer = setInterval(() => void this.dispatchOnce(), dispatchIntervalMs());
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatchDelivery(delivery: MerchantWebhookDelivery): Promise<void> {
    await this.process(delivery);
  }

  async dispatchOnce(): Promise<void> {
    let due: MerchantWebhookDelivery[];
    try {
      due = await this.repo.listDueWebhookDeliveries(["pending"], new Date().toISOString(), 25);
    } catch (error) {
      this.logger.error(`Webhook dispatcher failed to list due deliveries: ${errorMessage(error)}`, errorStack(error));
      return;
    }

    for (const delivery of due) {
      try {
        await this.process(delivery);
      } catch (error) {
        this.logger.error(`Webhook delivery ${delivery.id} dispatch failed: ${errorMessage(error)}`, errorStack(error));
      }
    }
  }

  private async process(delivery: MerchantWebhookDelivery): Promise<void> {
    const body = JSON.stringify(delivery.envelope);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.signatures.sign({ secret: delivery.signingSecret, timestamp, body });

    try {
      const response = await fetch(delivery.endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "AACP-Webhooks/1.0",
          "X-AACP-Event-Id": delivery.eventId,
          "X-AACP-Event-Type": delivery.eventType,
          "X-AACP-Timestamp": timestamp,
          "X-AACP-Signature": signature
        },
        body
      });
      const responseBody = await response.text().catch(() => "");
      if (response.ok) {
        const now = new Date().toISOString();
        await this.repo.updateWebhookDelivery({
          ...delivery,
          status: "delivered",
          attempts: delivery.attempts + 1,
          responseStatus: response.status,
          responseBody: responseBody.slice(0, 2000),
          error: undefined,
          nextAttemptAt: undefined,
          deliveredAt: now,
          updatedAt: now
        });
        return;
      }
      await this.retryOrFail(delivery, `http_${response.status}`, response.status, responseBody);
    } catch (error) {
      this.logger.warn(`Webhook delivery ${delivery.id} failed: ${String(error)}`);
      await this.retryOrFail(delivery, "network_error");
    }
  }

  private async retryOrFail(delivery: MerchantWebhookDelivery, error: string, status?: number, responseBody?: string): Promise<void> {
    const attempts = delivery.attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    const now = new Date();
    const delaySeconds = Math.min(3600, Math.pow(2, attempts) * 30);
    await this.repo.updateWebhookDelivery({
      ...delivery,
      status: failed ? "failed" : "pending",
      attempts,
      responseStatus: status,
      responseBody: responseBody?.slice(0, 2000),
      error,
      nextAttemptAt: failed ? undefined : new Date(now.getTime() + delaySeconds * 1000).toISOString(),
      updatedAt: now.toISOString()
    });
  }
}

function dispatchIntervalMs(): number {
  const configured = Number(process.env.WEBHOOK_DISPATCH_INTERVAL_MS);
  if (Number.isFinite(configured) && configured >= 100) return configured;
  return DEFAULT_DISPATCH_INTERVAL_MS;
}

function webhookDispatcherEnabled(): boolean {
  const configured = process.env.WEBHOOK_DISPATCHER_ENABLED?.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(configured ?? "")) return true;
  if (["0", "false", "no", "off"].includes(configured ?? "")) return false;
  return process.env.NODE_ENV === "production";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
