import { BadRequestException, Inject, Injectable } from "@nestjs/common";
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
    const existing = await this.repository.getConnection(merchantId, "asaas");
    if (existing) return requiredConnection(this.repository, merchantId, "asaas");

    const cpfCnpjDigits = rawInput.cpfCnpj.replace(/\D+/g, "");
    if (![11, 14].includes(cpfCnpjDigits.length)) throw new BadRequestException("asaas_tax_id_invalid");
    const isCnpj = cpfCnpjDigits.length === 14;
    if (isCnpj && !rawInput.companyType) throw new BadRequestException("asaas_company_type_required");
    if (!isCnpj && (!rawInput.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawInput.birthDate) || !Number.isFinite(Date.parse(rawInput.birthDate)) || rawInput.birthDate >= new Date().toISOString().slice(0, 10))) throw new BadRequestException("asaas_birth_date_required");
    const input: AsaasSubaccountInput = {
      ...rawInput,
      cpfCnpj: cpfCnpjDigits,
      ...(isCnpj
        ? { companyType: rawInput.companyType, birthDate: undefined }
        : { companyType: undefined, birthDate: rawInput.birthDate }),
    };

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

