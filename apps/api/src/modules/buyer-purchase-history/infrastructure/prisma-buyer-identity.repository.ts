import type { PrismaClient } from "@prisma/client";
import type { CustomerHints } from "@aacp/shared-types";
import { CheckoutIdentityService } from "../../checkout/domain/services/checkout-identity.service.js";
import type { BuyerIdentityRepository } from "../domain/ports/buyer-identity.repository.port.js";

export class PrismaBuyerIdentityRepository implements BuyerIdentityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveGlobalUserId(
    merchantId: string,
    customer?: CustomerHints,
  ): Promise<string> {
    const identityKey = CheckoutIdentityService.identityKey(
      merchantId,
      customer,
    );
    if (!identityKey) return `usr_${crypto.randomUUID()}`;

    const localKey = identityKey.slice(`${merchantId}:`.length);
    const row = await this.prisma.buyerIdentity.upsert({
      where: {
        merchantId_identityKey: {
          merchantId,
          identityKey: localKey,
        },
      },
      create: {
        merchantId,
        identityKey: localKey,
        globalUserId: `usr_${crypto.randomUUID()}`,
      },
      update: {},
    });
    return row.globalUserId;
  }
}
