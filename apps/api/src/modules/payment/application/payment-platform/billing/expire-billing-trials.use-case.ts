import { Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";

@Injectable()
export class ExpireBillingTrialsUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  execute(input: { now?: Date; limit?: number } = {}): Promise<number> {
    return this.repository.expireTrials(input.now ?? new Date(), input.limit ?? 100);
  }
}

