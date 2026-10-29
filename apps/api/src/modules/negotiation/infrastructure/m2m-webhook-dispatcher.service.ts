import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type { M2MManagementStore, M2MProtocolConfigRow } from "../application/m2m-management.use-cases.js";
import { M2M_MANAGEMENT_STORE } from "../application/m2m-management.use-cases.js";

export type M2MWebhookEvent =
  | "m2m.session.started"
  | "m2m.negotiation.completed"
  | "m2m.checkout.completed"
  | "m2m.agent.registered";

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 5000;

@Injectable()
export class M2MWebhookDispatcherService {
  private readonly logger = new Logger(M2MWebhookDispatcherService.name);

  constructor(
    @Inject(M2M_MANAGEMENT_STORE) private readonly store: M2MManagementStore,
  ) {}

  async dispatch(merchantId: string, eventType: M2MWebhookEvent, payload: Record<string, unknown>): Promise<void> {
    const config = await this.store.getConfig(merchantId);
    if (!config?.enabled || !config.webhookUrl) return;

    const url = config.webhookUrl;
    const body = JSON.stringify({ event: eventType, merchant_id: merchantId, data: payload, timestamp: new Date().toISOString() });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-AACP-Event-Type": eventType,
            "X-AACP-Attempt": String(attempt),
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (resp.ok) {
          this.logger.debug(`Webhook delivered: ${eventType} → ${url} (${resp.status})`);
          return;
        }

        // Non-retryable 4xx
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429) {
          this.logger.warn(`Webhook failed permanently: ${eventType} → ${url} (${resp.status})`);
          return;
        }

        this.logger.warn(`Webhook attempt ${attempt}/${MAX_ATTEMPTS} failed: ${resp.status}`);
      } catch (e) {
        this.logger.warn(`Webhook attempt ${attempt}/${MAX_ATTEMPTS} network error: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Exponential backoff: 1s, 4s
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }

    this.logger.error(`Webhook exhausted retries: ${eventType} → ${url}`);
  }
}
