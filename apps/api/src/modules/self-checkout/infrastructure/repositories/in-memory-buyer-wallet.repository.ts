import { Injectable } from "@nestjs/common";
import { BuyerWalletEntity } from "../../domain/entities/buyer-wallet.entity.js";
import type { BuyerWalletRepository } from "../../domain/ports/buyer-wallet-repository.port.js";

@Injectable()
export class InMemoryBuyerWalletRepository implements BuyerWalletRepository {
  private readonly store = new Map<string, ReturnType<BuyerWalletEntity["snapshot"]>>();

  async findByBuyerUserId(buyer_user_id: string) {
    for (const data of this.store.values()) {
      if (data.buyer_user_id === buyer_user_id) return BuyerWalletEntity.rehydrate(data);
    }
    return null;
  }

  async save(wallet: BuyerWalletEntity) {
    this.store.set(wallet.id, wallet.snapshot());
  }
}
