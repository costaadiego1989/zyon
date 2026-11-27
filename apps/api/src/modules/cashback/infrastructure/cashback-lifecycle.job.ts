import { Inject, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import { CashbackService } from "../application/cashback.service.js";
import { CashbackNotificationService } from "../application/cashback-notification.service.js";

@Injectable()
export class CashbackLifecycleJob implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(CashbackLifecycleJob.name);
  constructor(private readonly cashback: CashbackService, @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
    private readonly notifications: CashbackNotificationService) {}

  onModuleInit() {
    for (const eventType of ["payment.status.changed", "order.completed", "order.fulfillment.completed", "order.delivered"]) {
      this.events.subscribe(eventType, async event => { await this.runForMerchant(event.merchantId); }, `cashback:${eventType}`);
    }
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.run(), 60_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async runForMerchant(merchantId: string) {
    const result = await this.cashback.reconcile(merchantId);
    for (const issue of result.issues) this.logger.warn({ event: "cashback_reconciliation_issue", ...issue });
    return result;
  }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.cashback.reconcile();
      for (const issue of result.issues) this.logger.warn({ event: "cashback_reconciliation_issue", ...issue });
      await this.notifications.run();
      return result;
    } catch { this.logger.error("cashback_reconciliation_failed"); }
    finally { this.running = false; }
  }
}
