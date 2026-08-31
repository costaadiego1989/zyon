import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_ENVIRONMENT,
  type PaymentPlatformEnvironment,
} from "../../../domain/ports/payment-platform-provider.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import type { PaymentConnectionSnapshot } from "../../../domain/payment-platform.types.js";
import { requiredConnection } from "../shared.js";

@Injectable()
export class SaveAsaasConnectionConfigUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(PAYMENT_PLATFORM_ENVIRONMENT)
    private readonly environment: PaymentPlatformEnvironment,
  ) {}

  async execute(
    merchantId: string,
    input: { apiKey: string; webhookToken?: string; sandbox: boolean },
  ): Promise<PaymentConnectionSnapshot> {
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new BadRequestException("asaas_api_key_required");
    await this.repository.saveConnection({
      merchantId,
      provider: "asaas",
      environment: input.sandbox ? "test" : this.environment.asaas,
      status: "active",
      externalAccountId: "manual",
      secret: JSON.stringify({ apiKey, webhookToken: input.webhookToken?.trim() ?? "" }),
      chargesEnabled: true,
      payoutsEnabled: true,
      requirements: [],
      syncedAt: new Date().toISOString(),
    });
    return requiredConnection(this.repository, merchantId, "asaas");
  }
}

