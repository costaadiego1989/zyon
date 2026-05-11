import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import type { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";

export interface UpdateBuyerProfileRequest {
  globalUserId: string;
  displayName?: string;
  phone?: string;
}

@Injectable()
export class UpdateBuyerProfileUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository
  ) {}

  async execute(input: UpdateBuyerProfileRequest): Promise<BuyerAccount> {
    const account = await this.repo.findByGlobalUserId(input.globalUserId);
    if (!account) throw new NotFoundException("buyer_account_not_found");
    const updated = account.withUpdatedProfile(input.displayName, input.phone);
    await this.repo.save(updated);
    return updated;
  }
}
