import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { OrderQuotaService } from "../../application/services/order-quota.service.js";

/** Persists deadline transitions and reminders even while the store has no traffic. */
@Injectable()
export class OrderQuotaReconciliationJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderQuotaReconciliationJob.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly quotas: OrderQuotaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.runOnce(), 60_000);
    this.timer.unref();
    void this.runOnce();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.quotas.reconcile();
    } catch (error) {
      this.logger.error("order-quota.reconciliation-failed", error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}
