import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ExpireBillingTrialsUseCase } from "../payment-platform.use-cases.js";

const TRIAL_EXPIRATION_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const TRIAL_EXPIRATION_BATCH_SIZE = 100;

@Injectable()
export class BillingTrialExpirationJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingTrialExpirationJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly expireTrials: ExpireBillingTrialsUseCase) {}

  onModuleInit(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), TRIAL_EXPIRATION_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const expired = await this.expireTrials.execute({ limit: TRIAL_EXPIRATION_BATCH_SIZE });
      if (expired > 0) {
        this.logger.log(`Reconciled ${expired} expired billing trial(s) to Starter`);
      }
      return expired;
    } catch (err) {
      this.logger.warn(`Billing trial expiration failed: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
