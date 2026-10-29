import { Injectable, Inject, HttpException, NotFoundException , Logger} from "@nestjs/common";
import { BUYER_USER_REPOSITORY, type BuyerUserRepository } from "../../domain/ports/buyer-user-repository.port.js";
import { BUYER_WALLET_REPOSITORY, type BuyerWalletRepository } from "../../domain/ports/buyer-wallet-repository.port.js";
import { checkConsent } from "../../domain/policies/consent.policy.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface AddSavedAddressInput {
  buyer_user_id: string;
  label: string;
  zip_code: string;
  street: string;
  city: string;
  state: string;
  country: string;
  is_default?: boolean;
}

@Injectable()
export class AddSavedAddressUseCase {
  private readonly logger = new Logger(AddSavedAddressUseCase.name);

  constructor(
    @Inject(BUYER_USER_REPOSITORY) private readonly users: BuyerUserRepository,
    @Inject(BUYER_WALLET_REPOSITORY) private readonly wallets: BuyerWalletRepository
  ) {}

  async execute(input: AddSavedAddressInput) {
    const user = await this.users.findById(input.buyer_user_id);
    if (!user) throw new NotFoundException("BUYER_NOT_FOUND");

    const consent = checkConsent(user);
    if (!consent.allowed) throw new HttpException(consent.reason ?? "CONSENT_REQUIRED", 451);

    const wallet = await this.wallets.findByBuyerUserId(input.buyer_user_id);
    if (!wallet) throw new NotFoundException("WALLET_NOT_FOUND");

    const updated = wallet.addAddress({
      label: input.label,
      zip_code: input.zip_code,
      street: input.street,
      city: input.city,
      state: input.state,
      country: input.country,
      is_default: input.is_default ?? false,
    });

    await this.wallets.save(updated);
    return updated.snapshot();
  }
}
