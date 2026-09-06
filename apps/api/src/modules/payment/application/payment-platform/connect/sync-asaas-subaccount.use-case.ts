import { Inject, Injectable } from "@nestjs/common";
import {
  ASAAS_PLATFORM_PORT,
  type AsaasPlatformPort,
} from "../../../domain/ports/payment-platform-provider.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import type { PaymentConnectionSnapshot } from "../../../domain/payment-platform.types.js";
import { requiredConnection, requiredAsaasSecret, providerGatewayError, providerErrorCode } from "../shared.js";

@Injectable()
export class SyncAsaasSubaccountUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(ASAAS_PLATFORM_PORT)
    private readonly asaas: AsaasPlatformPort,
  ) {}

  async execute(merchantId: string): Promise<PaymentConnectionSnapshot> {
    const connection = await requiredConnection(
      this.repository,
      merchantId,
      "asaas",
    );
    const apiKey = await requiredAsaasSecret(
      this.repository,
      merchantId,
    );
    try {
      const walletId = connection.walletId ?? await this.asaas.retrieveWalletId(apiKey, connection.environment === "test");
      if (!walletId) throw new Error("asaas_wallet_not_found");
      const provider = await this.asaas.retrieveAccountStatus(apiKey, connection.environment === "test");
      const requirements = [
        ["commercial_info", provider.commercialInfo],
        ["bank_account_info", provider.bankAccountInfo],
        ["documentation", provider.documentation],
      ]
        .filter(([, status]) => status !== "APPROVED")
        .map(([name, status]) => `${name}:${status.toLowerCase()}`);
      await this.repository.saveConnection({
        merchantId,
        provider: "asaas",
        environment: connection.environment,
        status:
          provider.general === "APPROVED" ? "active" : provider.general === "REJECTED" ? "restricted" : "pending",
        externalAccountId: connection.externalAccountId,
        walletId,
        chargesEnabled: provider.general === "APPROVED",
        payoutsEnabled: provider.general === "APPROVED",
        requirements,
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.repository.saveConnection({
        merchantId,
        provider: "asaas",
        environment: connection.environment,
        status: "degraded",
        externalAccountId: connection.externalAccountId,
        walletId: connection.walletId,
        errorCode: providerErrorCode(error),
      });
      throw providerGatewayError("asaas", error);
    }
    return requiredConnection(this.repository, merchantId, "asaas");
  }
}

