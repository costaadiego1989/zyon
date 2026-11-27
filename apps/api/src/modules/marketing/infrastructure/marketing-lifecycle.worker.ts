import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  MARKETING_REPOSITORY,
  type MarketingRepository,
} from "../domain/marketing.repository.js";
import {
  MARKETING_CLOCK,
  type MarketingClock,
} from "../domain/marketing-context.port.js";
import { MarketingLifecycleService } from "../application/marketing-lifecycle.service.js";
import { MarketingObservability } from "./marketing-observability.js";

@Injectable()
export class MarketingLifecycleWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(
    @Inject(MARKETING_REPOSITORY)
    private readonly repository: MarketingRepository,
    @Inject(MARKETING_CLOCK) private readonly clock: MarketingClock,
    private readonly lifecycle: MarketingLifecycleService,
    private readonly observability: MarketingObservability
  ) {}
  onModuleInit() {
    if (process.env.MARKETING_LIFECYCLE_WORKER_ENABLED !== "true") return;
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => {});
    }, 15_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async runOnce() {
    if (this.busy) return;
    this.busy = true;
    try {
      return await this.observability.run("lifecycle_scan", async () => {
        const now = this.clock.now();
        for (const merchantId of await this.repository.dueHistoryJobs(
          now,
          10
        )) {
          try {
            await this.lifecycle.process(merchantId);
          } catch {
            /* Per-store failure is measured; continue other stores. */
          }
        }
        for (const merchantId of await this.repository.dueRetention(now, 10)) {
          try {
            await this.lifecycle.retain(merchantId);
          } catch {
            /* Retention fails closed and retries on the next scan. */
          }
        }
      });
    } finally {
      this.busy = false;
    }
  }
}
