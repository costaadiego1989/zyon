import type { BuyerCheckoutTemplateEntity } from "../entities/buyer-checkout-template.entity.js";

export const BUYER_TEMPLATE_REPOSITORY = Symbol("BUYER_TEMPLATE_REPOSITORY");

export interface BuyerTemplateRepository {
  /** P0 fix: scoped by buyer_user_id to prevent IDOR cross-account access. */
  findById(id: string, buyer_user_id: string): Promise<BuyerCheckoutTemplateEntity | null>;
  findByBuyerUserId(buyer_user_id: string): Promise<BuyerCheckoutTemplateEntity[]>;
  save(template: BuyerCheckoutTemplateEntity): Promise<void>;
}
