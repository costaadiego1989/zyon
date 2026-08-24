import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ReleasePaymentHoldsUseCase } from "../application/payment-hold.use-cases.js";

const RELEASE_INTERVAL_MS = 60_000 * 15; // Every 15 minutes

@Injectable()
export class PaymentHoldReleaseJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentHoldReleaseJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly releaseHolds: ReleasePaymentHoldsUseCase) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.run(), RELEASE_INTERVAL_MS);
    this.logger.log("PaymentHold release job started (every 15min)");
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    try {
      const { released } = await this.releaseHolds.execute();
      if (released > 0) {
        this.logger.log(`Released ${released} holds this cycle`);
      }
    } catch (err) {
      this.logger.error(`Hold release failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
