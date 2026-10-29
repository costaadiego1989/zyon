import { Inject, Injectable, NotFoundException , Logger} from "@nestjs/common";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import type { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class GetBuyerProfileUseCase {
  private readonly logger = new Logger(GetBuyerProfileUseCase.name);

  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository
  ) {}

  async execute(globalUserId: string): Promise<BuyerAccount> {
    const account = await this.repo.findByGlobalUserId(globalUserId);
    if (!account) throw new NotFoundException("buyer_account_not_found");
    return account;
  }
}
