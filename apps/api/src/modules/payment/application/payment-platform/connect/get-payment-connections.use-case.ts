import { Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import type { PaymentConnectionSnapshot } from "../../../domain/payment-platform.types.js";

@Injectable()
export class GetPaymentConnectionsUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  execute(merchantId: string): Promise<PaymentConnectionSnapshot[]> {
    return this.repository.listConnections(merchantId);
  }
}

