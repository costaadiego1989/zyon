import type { BuyerWalletEntity } from "../entities/buyer-wallet.entity.js";

export const BUYER_WALLET_REPOSITORY = Symbol("BUYER_WALLET_REPOSITORY");

export interface BuyerWalletRepository {
  findByBuyerUserId(buyer_user_id: string): Promise<BuyerWalletEntity | null>;
  save(wallet: BuyerWalletEntity): Promise<void>;
}
