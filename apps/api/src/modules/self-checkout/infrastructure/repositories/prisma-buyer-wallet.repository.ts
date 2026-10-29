import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BuyerWalletEntity } from "../../domain/entities/buyer-wallet.entity.js";
import type { BuyerWalletRepository } from "../../domain/ports/buyer-wallet-repository.port.js";

@Injectable()
export class PrismaBuyerWalletRepository implements BuyerWalletRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByBuyerUserId(buyer_user_id: string): Promise<BuyerWalletEntity | null> {
    const row = await this.prisma.selfCheckoutWallet.findUnique({
      where: { buyerUserId: buyer_user_id },
      include: { addresses: true, paymentMethods: true },
    });
    if (!row) return null;
    return this.toDomain(row);
  }

  async save(wallet: BuyerWalletEntity): Promise<void> {
    const snap = wallet.snapshot();

    // Use a transaction to atomically replace wallet + nested collections.
    // Optimistic locking: increment version on every save.
    await this.prisma.$transaction(async (tx) => {
      // Upsert the wallet row (creates on first save, updates on subsequent).
      await tx.selfCheckoutWallet.upsert({
        where: { id: snap.id },
        update: { version: { increment: 1 } },
        create: {
          id: snap.id,
          buyerUserId: snap.buyer_user_id,
          version: 0,
        },
      });

      // Replace addresses: delete all then re-create from snapshot.
      await tx.selfCheckoutSavedAddress.deleteMany({ where: { walletId: snap.id } });
      if (snap.saved_addresses.length > 0) {
        await tx.selfCheckoutSavedAddress.createMany({
          data: snap.saved_addresses.map((a) => ({
            id: a.id,
            walletId: snap.id,
            label: a.label,
            zipCode: a.zip_code,
            street: a.street,
            city: a.city,
            state: a.state,
            country: a.country,
            isDefault: a.is_default,
          })),
        });
      }

      // Replace payment methods: delete all then re-create.
      await tx.selfCheckoutSavedPaymentMethod.deleteMany({ where: { walletId: snap.id } });
      if (snap.saved_payment_methods.length > 0) {
        await tx.selfCheckoutSavedPaymentMethod.createMany({
          data: snap.saved_payment_methods.map((m) => ({
            id: m.id,
            walletId: snap.id,
            label: m.label,
            gateway: m.gateway,
            gatewayToken: m.gateway_token,
            lastFour: m.last_four,
            brand: m.brand,
            expiresAt: m.expires_at,
            isDefault: m.is_default,
          })),
        });
      }
    });
  }

  private toDomain(row: any): BuyerWalletEntity {
    return BuyerWalletEntity.rehydrate({
      id: row.id,
      buyer_user_id: row.buyerUserId,
      saved_addresses: (row.addresses ?? []).map((a: any) => ({
        id: a.id,
        wallet_id: a.walletId,
        label: a.label,
        zip_code: a.zipCode,
        street: a.street,
        city: a.city,
        state: a.state,
        country: a.country,
        is_default: a.isDefault,
      })),
      saved_payment_methods: (row.paymentMethods ?? []).map((m: any) => ({
        id: m.id,
        wallet_id: m.walletId,
        label: m.label,
        gateway: m.gateway,
        gateway_token: m.gatewayToken,
        last_four: m.lastFour,
        brand: m.brand,
        expires_at: m.expiresAt,
        is_default: m.isDefault,
      })),
    });
  }
}
