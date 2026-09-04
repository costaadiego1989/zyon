import { Inject, Injectable } from "@nestjs/common";
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
    rawInput: AsaasSubaccountInput,
  ): Promise<PaymentConnectionSnapshot> {
    // Asaas requires companyType for CNPJ (PJ) accounts and birthDate for CPF
    // (PF). Default the fields that aren't collected in our system so creation
    // doesn't fail with "É necessário informar o tipo de empresa".
    const cpfCnpjDigits = rawInput.cpfCnpj.replace(/\D+/g, "");
    const isCnpj = cpfCnpjDigits.length === 14;
    const input: AsaasSubaccountInput = {
      ...rawInput,
      cpfCnpj: cpfCnpjDigits,
      ...(isCnpj
        ? { companyType: rawInput.companyType ?? "LIMITED" }
        : { companyType: undefined, birthDate: rawInput.birthDate ?? "1990-01-01" }),
    };

    // Already linked locally → idempotent, return the existing connection.
    const existing = await this.repository.getConnection(merchantId, "asaas");
    if (existing) {
      return requiredConnection(this.repository, merchantId, "asaas");
    }

    try {
      // A merchant may already have a subaccount on the root account (created
      // earlier, or its local record was lost). Recover it instead of trying to
      // create a duplicate (Asaas rejects duplicate CPF/CNPJ).
      const found = await this.asaas.findSubaccountByCpfCnpj(input.cpfCnpj);
      if (found) {
        const { apiKey } = await this.asaas.createSubaccountApiKey(found.accountId);
        const walletId = (await this.asaas.retrieveWalletId(apiKey)) ?? undefined;
        await this.repository.saveConnection({
          merchantId,
          provider: "asaas",
          environment: this.environment.asaas,
          status: "pending",
          externalAccountId: found.accountId,
          walletId,
          secret: apiKey,
          requirements: ["documentation"],
        });
        return requiredConnection(this.repository, merchantId, "asaas");
      }

      // No subaccount yet → create a new one.
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

