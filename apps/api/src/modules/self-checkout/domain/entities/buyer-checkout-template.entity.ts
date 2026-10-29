import { randomUUID } from "crypto";

export interface BuyerCheckoutTemplateSnapshot {
  id: string;
  buyer_user_id: string;
  merchant_id: string;
  name: string;
  saved_address_id: string;
  saved_payment_method_id: string;
  preferred_shipping_method_id: string | null;
  is_active: boolean;
  created_at: Date;
}

export class BuyerCheckoutTemplateEntity {
  private constructor(private readonly data: BuyerCheckoutTemplateSnapshot) {}

  static create(input: Omit<BuyerCheckoutTemplateSnapshot, "id" | "created_at" | "is_active">): BuyerCheckoutTemplateEntity {
    return new BuyerCheckoutTemplateEntity({ id: randomUUID(), is_active: true, created_at: new Date(), ...input });
  }

  static rehydrate(data: BuyerCheckoutTemplateSnapshot): BuyerCheckoutTemplateEntity {
    return new BuyerCheckoutTemplateEntity(data);
  }

  get id() { return this.data.id; }
  get buyer_user_id() { return this.data.buyer_user_id; }
  get merchant_id() { return this.data.merchant_id; }
  get name() { return this.data.name; }
  get saved_address_id() { return this.data.saved_address_id; }
  get saved_payment_method_id() { return this.data.saved_payment_method_id; }
  get preferred_shipping_method_id() { return this.data.preferred_shipping_method_id; }
  get is_active() { return this.data.is_active; }
  get created_at() { return this.data.created_at; }

  deactivate(): BuyerCheckoutTemplateEntity {
    return new BuyerCheckoutTemplateEntity({ ...this.data, is_active: false });
  }

  update(name: string): BuyerCheckoutTemplateEntity {
    return new BuyerCheckoutTemplateEntity({ ...this.data, name });
  }

  snapshot(): BuyerCheckoutTemplateSnapshot {
    return { ...this.data };
  }
}
