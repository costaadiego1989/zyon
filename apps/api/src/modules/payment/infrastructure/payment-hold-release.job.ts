import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { MakePaymentHoldsPayoutReadyUseCase } from "../application/payment-hold.use-cases.js";
import { SubmitReadyPaymentHoldsUseCase } from "../application/payment-hold-payout.use-case.js";

const PAYOUT_READINESS_INTERVAL_MS = 60_000 * 15;

@Injectable()
export class PaymentHoldPayoutReadinessJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentHoldPayoutReadinessJob.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly makePayoutReady: MakePaymentHoldsPayoutReadyUseCase,
    private readonly submitReadyPayouts: SubmitReadyPaymentHoldsUseCase,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.run(), PAYOUT_READINESS_INTERVAL_MS);
    this.logger.log("Payment-hold payout-readiness job started (every 15min)");
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    try {
      const { payoutReady } = await this.makePayoutReady.execute();
      if (payoutReady > 0) this.logger.log(`${payoutReady} hold(s) became payout-ready this cycle`);
      const result = await this.submitReadyPayouts.execute();
      if (result.claimed > 0) {
        this.logger.log(`Payout submission cycle: ${result.submitted} submitted, ${result.failed} failed, ${result.unresolved} unresolved`);
      }
    } catch (err) {
      this.logger.error(`Payment-hold payout-readiness failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
