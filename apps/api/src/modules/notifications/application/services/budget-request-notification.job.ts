import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { BudgetRequestNotificationSender } from "../../infrastructure/adapters/budget-request-notification.sender.js";
import { PrismaBudgetRequestNotificationRepository } from "../../infrastructure/repositories/prisma-budget-request-notification.repository.js";
import type { QuotaDeliveryResult } from "../../domain/ports/order-quota-notice.port.js";

@Injectable()
export class BudgetRequestNotificationJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BudgetRequestNotificationJob.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly repository: PrismaBudgetRequestNotificationRepository,
    private readonly sender: BudgetRequestNotificationSender,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.runOnce(); }, 5_000);
    this.timer.unref();
    void this.runOnce();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  runOnce(): Promise<void> {
    if (this.stopping || this.running) return this.running ?? Promise.resolve();
    this.running = this.run().catch(() => this.logger.error("budget_request_notification_delivery_failed")).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async run(): Promise<void> {
    await this.repository.expireSending(new Date());
    for (let index = 0; index < 40; index++) {
      const now = new Date();
      const claim = await this.repository.claim(now);
      if (!claim) break;
      let result: QuotaDeliveryResult;
      let sending = false;
      try {
        const prepared = await this.sender.prepare(claim.request, claim.channel);
        if (!("send" in prepared)) result = prepared;
        else if (!await this.repository.begin(claim, new Date())) continue;
        else {
          sending = true;
          result = await sendWithDeadline(prepared.send);
        }
      } catch {
        result = { status: sending ? "unknown" : "retryable_failed", reason: sending ? "provider_acceptance_unknown" : "preparation_failed" };
      }
      if (result.status === "retryable_failed" && claim.attempts >= 12) result = { ...result, status: "failed" };
      const saved = await this.repository.finish(claim, result, new Date());
      if (!saved || result.status === "failed" || result.status === "unknown") {
        this.logger.error(`budget_request_notification_attention id=${claim.id} channel=${claim.channel} status=${result.status} reason=${result.reason ?? "lease_lost"}`);
      }
    }
  }
}

async function sendWithDeadline(send: () => Promise<QuotaDeliveryResult>): Promise<QuotaDeliveryResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(send),
      new Promise<QuotaDeliveryResult>((resolve) => { timer = setTimeout(() => resolve({ status: "unknown", reason: "provider_timeout" }), 40_000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
