import { Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";

@Injectable()
export class DeletePaymentConnectionUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async execute(merchantId: string, provider: "stripe" | "asaas" | "mercadopago"): Promise<{ success: boolean }> {
    await this.repository.deleteConnection(merchantId, provider);
    return { success: true };
  }
}

