import type { BuyerUserEntity } from "../entities/buyer-user.entity.js";

export const BUYER_USER_REPOSITORY = Symbol("BUYER_USER_REPOSITORY");

export interface BuyerUserRepository {
  findById(id: string): Promise<BuyerUserEntity | null>;
  findByEmail(email: string): Promise<BuyerUserEntity | null>;
  save(user: BuyerUserEntity): Promise<void>;
}
