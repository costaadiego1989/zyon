import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import type { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";

@Injectable()
export class GetBuyerProfileUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository
  ) {}

  async execute(globalUserId: string): Promise<BuyerAccount> {
    const account = await this.repo.findByGlobalUserId(globalUserId);
    if (!account) throw new NotFoundException("buyer_account_not_found");
    return account;
  }
}
