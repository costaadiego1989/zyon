import { Injectable } from "@nestjs/common";
import { BuyerCheckoutTemplateEntity } from "../../domain/entities/buyer-checkout-template.entity.js";
import type { BuyerTemplateRepository } from "../../domain/ports/buyer-template-repository.port.js";

@Injectable()
export class InMemoryBuyerTemplateRepository implements BuyerTemplateRepository {
  private readonly store = new Map<string, ReturnType<BuyerCheckoutTemplateEntity["snapshot"]>>();

  /** P0 fix: scope by buyer_user_id to prevent IDOR. Returns null if not owned. */
  async findById(id: string, buyer_user_id: string) {
    const data = this.store.get(id);
    if (!data || data.buyer_user_id !== buyer_user_id) return null;
    return BuyerCheckoutTemplateEntity.rehydrate(data);
  }

  async findByBuyerUserId(buyer_user_id: string) {
    return [...this.store.values()]
      .filter((d) => d.buyer_user_id === buyer_user_id)
      .map(BuyerCheckoutTemplateEntity.rehydrate);
  }

  async save(template: BuyerCheckoutTemplateEntity) {
    this.store.set(template.id, template.snapshot());
  }
}
