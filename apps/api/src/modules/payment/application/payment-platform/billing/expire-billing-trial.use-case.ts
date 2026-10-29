import { Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";

@Injectable()
export class ExpireBillingTrialUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  execute(input: { merchantId: string; now?: Date }): Promise<boolean> {
    return this.repository.expireTrial(input.merchantId, input.now ?? new Date());
  }
}

