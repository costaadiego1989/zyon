import type { PrismaClient } from "@prisma/client";
import type { BuyerIntentMemoryConsent } from "@zyon/shared-types";
import type { BuyerIntentConsentRepositoryPort } from "../../domain/ports/intent-memory-repository.port.js";
import {
  toDomainConsent,
  toPrismaCreateConsent,
  toPrismaUpdateConsent
} from "./prisma-intent-memory.converters.js";

export class PrismaBuyerIntentConsentRepository implements BuyerIntentConsentRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async saveConsent(consent: BuyerIntentMemoryConsent): Promise<void> {
    await this.prisma.buyerIntentMemoryConsent.upsert({
      where: {
        merchantId_globalUserId: {
          merchantId: consent.merchant_id,
          globalUserId: consent.global_user_id
        }
      },
      create: toPrismaCreateConsent(consent),
      update: toPrismaUpdateConsent(consent)
    });
  }

  async getConsent(
    merchantId: string,
    globalUserId: string
  ): Promise<BuyerIntentMemoryConsent | null> {
    const row = await this.prisma.buyerIntentMemoryConsent.findUnique({
      where: {
        merchantId_globalUserId: {
          merchantId,
          globalUserId
        }
      }
    });
    return row ? toDomainConsent(row) : null;
  }

  async deleteConsent(merchantId: string, globalUserId: string): Promise<void> {
    await this.prisma.buyerIntentMemoryConsent.delete({
      where: {
        merchantId_globalUserId: {
          merchantId,
          globalUserId
        }
      }
    }).catch(() => {
      // Idempotent: if not found, that's fine
    });
  }
}
