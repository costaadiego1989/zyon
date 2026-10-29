import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import {
  ASAAS_PLATFORM_PORT,
  type AsaasPlatformPort,
} from "../../../domain/ports/payment-platform-provider.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import type { PaymentConnectionSnapshot } from "../../../domain/payment-platform.types.js";
import { requiredConnection, requiredAsaasSecret, providerGatewayError } from "../shared.js";
import { parseAsaasSandboxEnv } from "../../../infrastructure/asaas-env.js";

/**
 * DEV/SANDBOX ONLY. Instantly approves the merchant's Asaas subaccount
 * (commercial data + documentation) so BaaS flows can be tested end to end
 * without the real KYC. Refuses outside sandbox.
 */
@Injectable()
export class ApproveAsaasSandboxUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(ASAAS_PLATFORM_PORT)
    private readonly asaas: AsaasPlatformPort,
  ) {}

  async execute(merchantId: string): Promise<PaymentConnectionSnapshot> {
    if (!parseAsaasSandboxEnv()) {
      throw new ForbiddenException("asaas_sandbox_approve_disabled_in_production");
    }
    await requiredConnection(this.repository, merchantId, "asaas");
    const apiKey = await requiredAsaasSecret(this.repository, merchantId);
    try {
      await this.asaas.approveSandboxAccount(apiKey);
    } catch (error) {
      throw providerGatewayError("asaas", error);
    }
    // Reflect the freshly-approved state locally.
    const status = await this.asaas.retrieveAccountStatus(apiKey);
    const active = status.general === "APPROVED";
    const existing = await requiredConnection(this.repository, merchantId, "asaas");
    await this.repository.saveConnection({
      merchantId,
      provider: "asaas",
      environment: existing.environment,
      status: active ? "active" : "pending",
      externalAccountId: existing.externalAccountId ?? undefined,
      chargesEnabled: active,
      payoutsEnabled: active,
      requirements: [],
      syncedAt: new Date().toISOString(),
    });
    return requiredConnection(this.repository, merchantId, "asaas");
  }
}
