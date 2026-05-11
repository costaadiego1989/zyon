import { Injectable } from "@nestjs/common";
import { BuyerCheckoutTemplateEntity } from "../../domain/entities/buyer-checkout-template.entity.js";
import type { BuyerTemplateRepository } from "../../domain/ports/buyer-template-repository.port.js";

@Injectable()
export class InMemoryBuyerTemplateRepository implements BuyerTemplateRepository {
  private readonly store = new Map<string, ReturnType<BuyerCheckoutTemplateEntity["snapshot"]>>();

  async findById(id: string) {
    const data = this.store.get(id);
    return data ? BuyerCheckoutTemplateEntity.rehydrate(data) : null;
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
