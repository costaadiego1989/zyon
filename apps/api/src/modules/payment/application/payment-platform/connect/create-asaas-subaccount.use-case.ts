import { BadRequestException, ConflictException, HttpException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
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
import { SyncAsaasSubaccountUseCase } from "./sync-asaas-subaccount.use-case.js";

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
    authenticatedEmail?: string,
  ): Promise<PaymentConnectionSnapshot> {
    const existing = await this.repository.getConnection(merchantId, "asaas");
    if (existing && await this.repository.getConnectionSecret(merchantId, "asaas")) {
      return new SyncAsaasSubaccountUseCase(this.repository, this.asaas).execute(merchantId);
    }

    const cpfCnpjDigits = rawInput.cpfCnpj.replace(/\D+/g, "");
    if (![11, 14].includes(cpfCnpjDigits.length)) throw new BadRequestException("asaas_tax_id_invalid");
    const isCnpj = cpfCnpjDigits.length === 14;
    const input: AsaasSubaccountInput = {
      ...rawInput,
      cpfCnpj: cpfCnpjDigits,
      ...(isCnpj
        ? { companyType: rawInput.companyType, birthDate: undefined }
        : { companyType: undefined, birthDate: rawInput.birthDate }),
    };

    try {
      const platform = await this.asaas.resolvePlatformAccount(merchantId, input.cpfCnpj);
      if (platform) return await this.persistAndSync(merchantId, { ...platform, accountId: "platform" });
      // A merchant may already have a subaccount on the root account (created
      // earlier, or its local record was lost). Recover it instead of trying to
      // create a duplicate (Asaas rejects duplicate CPF/CNPJ).
      const found = await this.asaas.findSubaccountByCpfCnpj(input.cpfCnpj);
      if (found) {
        // A tax ID entered in the form must not grant access to another tenant's account.
        if (!authenticatedEmail || found.email?.trim().toLowerCase() !== authenticatedEmail.trim().toLowerCase()) {
          throw new ConflictException("asaas_account_owner_mismatch");
        }
        let apiKey: string;
        try {
          ({ apiKey } = await this.asaas.createSubaccountApiKey(found.accountId));
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("asaas_platform_request_failed_403:")) {
            throw new ServiceUnavailableException("asaas_account_recovery_unavailable");
          }
          throw error;
        }
        return await this.persistAndSync(merchantId, { accountId: found.accountId, apiKey });
      }

      // No subaccount yet → create a new one.
      if (isCnpj && !input.companyType) throw new BadRequestException("asaas_company_type_required");
      if (!isCnpj && (!input.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) || !Number.isFinite(Date.parse(input.birthDate)) || input.birthDate >= new Date().toISOString().slice(0, 10))) throw new BadRequestException("asaas_birth_date_required");
      const created = await this.asaas.createSubaccount(input);
      return await this.persistAndSync(merchantId, created);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw providerGatewayError("asaas", error);
    }
  }

  private async persistAndSync(merchantId: string, account: { accountId: string; apiKey: string; walletId?: string }): Promise<PaymentConnectionSnapshot> {
    // Persist the one-time credential before further network calls can fail.
    await this.repository.saveConnection({
      merchantId, provider: "asaas", environment: this.environment.asaas,
      status: "pending", externalAccountId: account.accountId,
      walletId: account.walletId, secret: account.apiKey, requirements: ["verification_pending"],
    });
    try {
      return await new SyncAsaasSubaccountUseCase(this.repository, this.asaas).execute(merchantId);
    } catch {
      // The account is linked even if the provider is temporarily unavailable.
      return requiredConnection(this.repository, merchantId, "asaas");
    }
  }
}

