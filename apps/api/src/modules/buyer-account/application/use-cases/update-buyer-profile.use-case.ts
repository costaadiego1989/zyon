import { Inject, Injectable, NotFoundException , Logger} from "@nestjs/common";
import type { CustomerAddress } from "@zyon/shared-types";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import type { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface UpdateBuyerProfileRequest {
  globalUserId: string;
  displayName?: string;
  phone?: string;
  address?: CustomerAddress;
}

@Injectable()
export class UpdateBuyerProfileUseCase {
  private readonly logger = new Logger(UpdateBuyerProfileUseCase.name);

  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository
  ) {}

  async execute(input: UpdateBuyerProfileRequest): Promise<BuyerAccount> {
    const account = await this.repo.findByGlobalUserId(input.globalUserId);
    if (!account) throw new NotFoundException("buyer_account_not_found");
    const updated = account.withUpdatedProfile(input.displayName, input.phone, input.address);
    await this.repo.save(updated);
    return updated;
  }
}
