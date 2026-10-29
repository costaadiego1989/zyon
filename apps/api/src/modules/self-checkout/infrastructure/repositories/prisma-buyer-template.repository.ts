import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BuyerCheckoutTemplateEntity } from "../../domain/entities/buyer-checkout-template.entity.js";
import type { BuyerTemplateRepository } from "../../domain/ports/buyer-template-repository.port.js";

@Injectable()
export class PrismaBuyerTemplateRepository implements BuyerTemplateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, buyer_user_id: string): Promise<BuyerCheckoutTemplateEntity | null> {
    const row = await this.prisma.selfCheckoutTemplate.findFirst({
      where: { id, buyerUserId: buyer_user_id },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByBuyerUserId(buyer_user_id: string): Promise<BuyerCheckoutTemplateEntity[]> {
    const rows = await this.prisma.selfCheckoutTemplate.findMany({
      where: { buyerUserId: buyer_user_id },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async save(template: BuyerCheckoutTemplateEntity): Promise<void> {
    const snap = template.snapshot();
    await this.prisma.selfCheckoutTemplate.upsert({
      where: { id: snap.id },
      update: {
        name: snap.name,
        savedAddressId: snap.saved_address_id,
        savedPaymentMethodId: snap.saved_payment_method_id,
        preferredShippingMethodId: snap.preferred_shipping_method_id,
        isActive: snap.is_active,
      },
      create: {
        id: snap.id,
        buyerUserId: snap.buyer_user_id,
        merchantId: snap.merchant_id,
        name: snap.name,
        savedAddressId: snap.saved_address_id,
        savedPaymentMethodId: snap.saved_payment_method_id,
        preferredShippingMethodId: snap.preferred_shipping_method_id,
        isActive: snap.is_active,
        createdAt: snap.created_at,
      },
    });
  }

  private toDomain(row: any): BuyerCheckoutTemplateEntity {
    return BuyerCheckoutTemplateEntity.rehydrate({
      id: row.id,
      buyer_user_id: row.buyerUserId,
      merchant_id: row.merchantId,
      name: row.name,
      saved_address_id: row.savedAddressId,
      saved_payment_method_id: row.savedPaymentMethodId,
      preferred_shipping_method_id: row.preferredShippingMethodId,
      is_active: row.isActive,
      created_at: row.createdAt,
    });
  }
}
