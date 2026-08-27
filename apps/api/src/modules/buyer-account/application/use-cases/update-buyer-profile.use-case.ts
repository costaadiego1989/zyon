import { BadRequestException, Inject, Injectable, NotFoundException, Logger, Optional } from "@nestjs/common";
import type { CustomerAddress } from "@zyon/shared-types";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import type { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { PAYMENT_PROVIDER_PORT, type PaymentProviderPort } from "../../../payment/domain/ports/payment-provider.port.js";

export interface UpdateBuyerProfileRequest {
  globalUserId: string;
  displayName?: string;
  phone?: string;
  email?: string;
  cpf?: string;
  address?: CustomerAddress;
}

function isValidCpf(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // all same digit
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (Number(digits[9]) !== d1) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  return Number(digits[10]) === d2;
}

@Injectable()
export class UpdateBuyerProfileUseCase {
  private readonly logger = new Logger(UpdateBuyerProfileUseCase.name);

  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository,
    @Optional() @Inject(PAYMENT_PROVIDER_PORT) private readonly paymentProvider?: PaymentProviderPort,
  ) {}

  async execute(input: UpdateBuyerProfileRequest): Promise<BuyerAccount> {
    const account = await this.repo.findByGlobalUserId(input.globalUserId);
    if (!account) throw new NotFoundException("buyer_account_not_found");

    if (input.cpf && !isValidCpf(input.cpf)) {
      throw new BadRequestException("cpf_invalid");
    }

    const updated = account.withUpdatedProfile(input.displayName, input.phone, input.address, input.cpf);

    // If a real email is provided (not the placeholder), update it
    let finalAccount = input.email && !input.email.includes("@buyer.aacp")
      ? new (updated.constructor as any)({ ...updated, email: input.email, updatedAt: new Date() })
      : updated;

    // Create Asaas customer when CPF is set and no asaasCustomerId exists yet
    if (input.cpf && !finalAccount.asaasCustomerId && this.paymentProvider?.createCustomer) {
      try {
        const asaasId = await this.paymentProvider.createCustomer({
          merchantId: "", // not needed for Asaas global customer
          name: finalAccount.displayName,
          email: finalAccount.email,
          cpfCnpj: input.cpf,
          phone: finalAccount.phone,
        });
        finalAccount = finalAccount.withAsaasCustomerId(asaasId);
        this.logger.log(`Asaas customer created: ${asaasId} for buyer ${input.globalUserId}`);
      } catch (err) {
        this.logger.warn(`Failed to create Asaas customer (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await this.repo.save(finalAccount);
    return finalAccount;
  }
}
