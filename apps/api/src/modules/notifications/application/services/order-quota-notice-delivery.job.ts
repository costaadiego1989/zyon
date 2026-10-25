import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { DeliverOrderQuotaNoticeUseCase } from "../use-cases/deliver-order-quota-notice.use-case.js";

@Injectable()
export class OrderQuotaNoticeDeliveryJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderQuotaNoticeDeliveryJob.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping = false;
  private nextPollAt = 0;
  private failures = 0;

  constructor(@Inject(DeliverOrderQuotaNoticeUseCase) private readonly deliver: DeliverOrderQuotaNoticeUseCase) {}

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
    if (this.stopping || Date.now() < this.nextPollAt) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.deliver.execute().then(() => {
      this.failures = 0;
      this.nextPollAt = 0;
    }).catch(() => {
      this.failures++;
      this.nextPollAt = Date.now() + Math.min(60_000, 5_000 * 2 ** Math.min(this.failures - 1, 4));
      this.logger.error("order_quota_delivery_poll_failed");
    }).finally(() => { this.running = undefined; });
    return this.running;
  }
}
