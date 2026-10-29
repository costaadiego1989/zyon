import { Injectable, Inject, NotFoundException , Logger} from "@nestjs/common";
import { BUYER_WALLET_REPOSITORY, type BuyerWalletRepository } from "../../domain/ports/buyer-wallet-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class DeleteSavedPaymentMethodUseCase {
  private readonly logger = new Logger(DeleteSavedPaymentMethodUseCase.name);

  constructor(
    @Inject(BUYER_WALLET_REPOSITORY) private readonly wallets: BuyerWalletRepository
  ) {}

  async execute(buyer_user_id: string, method_id: string): Promise<void> {
    const wallet = await this.wallets.findByBuyerUserId(buyer_user_id);
    if (!wallet) throw new NotFoundException("WALLET_NOT_FOUND");
    const updated = wallet.removePaymentMethod(method_id);
    await this.wallets.save(updated);
  }
}
