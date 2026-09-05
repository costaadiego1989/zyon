import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  ASAAS_PLATFORM_PORT,
  type AsaasPlatformPort,
} from "../../../domain/ports/payment-platform-provider.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import type { PaymentConnectionSnapshot } from "../../../domain/payment-platform.types.js";
import { requiredConnection, providerGatewayError } from "../shared.js";

@Injectable()
export class SaveAsaasConnectionConfigUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(ASAAS_PLATFORM_PORT)
    private readonly asaas: AsaasPlatformPort,
  ) {}

  async execute(
    merchantId: string,
    input: { apiKey: string; webhookToken?: string; sandbox: boolean },
  ): Promise<PaymentConnectionSnapshot> {
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new BadRequestException("asaas_api_key_required");
    const keySandbox = apiKey.startsWith("$aact_hmlg_");
    const keyLive = apiKey.startsWith("$aact_prod_");
    if (/\s/.test(apiKey)) throw new BadRequestException("asaas_api_key_invalid");
    if ((keySandbox || keyLive) && keySandbox !== input.sandbox) throw new BadRequestException("asaas_environment_mismatch");
    let status: Awaited<ReturnType<AsaasPlatformPort["retrieveAccountStatus"]>>;
    let walletId: string | null;
    try {
      [status, walletId] = await Promise.all([
        this.asaas.retrieveAccountStatus(apiKey, input.sandbox),
        this.asaas.retrieveWalletId(apiKey, input.sandbox),
      ]);
    } catch (error) {
      throw providerGatewayError("asaas", error);
    }
    if (!walletId) throw new BadRequestException("asaas_wallet_not_found");
    const active = status.general === "APPROVED";
    const requirements = [
      ["commercial_info", status.commercialInfo], ["bank_account_info", status.bankAccountInfo], ["documentation", status.documentation],
    ].filter(([, value]) => value !== "APPROVED").map(([key, value]) => `${key}:${String(value).toLowerCase()}`);
    await this.repository.saveConnection({
      merchantId,
      provider: "asaas",
      environment: input.sandbox ? "test" : "live",
      status: active ? "active" : "pending",
      externalAccountId: "manual",
      walletId,
      secret: JSON.stringify({ apiKey, webhookToken: input.webhookToken?.trim() ?? "" }),
      chargesEnabled: active,
      payoutsEnabled: active,
      requirements,
      syncedAt: new Date().toISOString(),
    });
    return requiredConnection(this.repository, merchantId, "asaas");
  }
}

