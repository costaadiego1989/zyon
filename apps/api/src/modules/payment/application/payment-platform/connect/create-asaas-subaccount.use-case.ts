import { ConflictException, Inject, Injectable } from "@nestjs/common";
import {
  ASAAS_PLATFORM_PORT,
  PAYMENT_PLATFORM_ENVIRONMENT,
  type AsaasPlatformPort,
  type PaymentPlatformEnvironment,
} from "../../../domain/ports/payment-platform-provider.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import type { AsaasSubaccountInput, PaymentConnectionSnapshot } from "../../../domain/payment-platform.types.js";
import { requiredConnection, providerGatewayError } from "../shared.js";

@Injectable()
export class CreateAsaasSubaccountUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(ASAAS_PLATFORM_PORT)
    private readonly asaas: AsaasPlatformPort,
    @Inject(PAYMENT_PLATFORM_ENVIRONMENT)
    private readonly environment: PaymentPlatformEnvironment,
  ) {}

  async execute(
    merchantId: string,
    input: AsaasSubaccountInput,
  ): Promise<PaymentConnectionSnapshot> {
    const existing = await this.repository.getConnection(
      merchantId,
      "asaas",
    );
    if (existing) {
      throw new ConflictException("asaas_subaccount_already_exists");
    }
    try {
      const created = await this.asaas.createSubaccount(input);
      await this.repository.saveConnection({
        merchantId,
        provider: "asaas",
        environment: this.environment.asaas,
        status: "pending",
        externalAccountId: created.accountId,
        walletId: created.walletId,
        secret: created.apiKey,
        requirements: ["documentation"],
      });
      return requiredConnection(this.repository, merchantId, "asaas");
    } catch (error) {
      throw providerGatewayError("asaas", error);
    }
  }
}

