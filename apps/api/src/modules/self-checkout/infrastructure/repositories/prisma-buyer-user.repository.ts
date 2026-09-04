import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BuyerUserEntity } from "../../domain/entities/buyer-user.entity.js";
import type { BuyerUserRepository } from "../../domain/ports/buyer-user-repository.port.js";

@Injectable()
export class PrismaBuyerUserRepository implements BuyerUserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<BuyerUserEntity | null> {
    const row = await this.prisma.selfCheckoutBuyerUser.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findByEmail(email: string): Promise<BuyerUserEntity | null> {
    const normalised = email.trim().toLowerCase();
    const row = await this.prisma.selfCheckoutBuyerUser.findFirst({
      where: { email: normalised },
    });
    return row ? this.toDomain(row) : null;
  }

  async save(user: BuyerUserEntity): Promise<void> {
    const snap = user.snapshot();
    await this.prisma.selfCheckoutBuyerUser.upsert({
      where: { id: snap.id },
      update: {
        displayName: snap.display_name,
        consentVersion: snap.consent_version,
        consentUpdatedAt: snap.consent_updated_at,
        marketingOptIn: snap.marketing_opt_in,
      },
      create: {
        id: snap.id,
        merchantId: snap.merchant_id,
        email: snap.email.toLowerCase(),
        passwordHash: snap.password_hash,
        displayName: snap.display_name,
        consentVersion: snap.consent_version,
        consentUpdatedAt: snap.consent_updated_at,
        marketingOptIn: snap.marketing_opt_in,
        createdAt: snap.created_at,
      },
    });
  }

  private toDomain(row: any): BuyerUserEntity {
    return BuyerUserEntity.rehydrate({
      id: row.id,
      merchant_id: row.merchantId,
      email: row.email,
      password_hash: row.passwordHash,
      display_name: row.displayName,
      consent_version: row.consentVersion,
      consent_updated_at: row.consentUpdatedAt,
      marketing_opt_in: row.marketingOptIn,
      created_at: row.createdAt,
    });
  }
}
