import { Injectable } from "@nestjs/common";
import type { CustomerHints } from "@zyon/shared-types";
import { CheckoutIdentityService } from "../../checkout/domain/services/checkout-identity.service.js";
import type { BuyerIdentityRepository } from "../domain/ports/buyer-identity.repository.port.js";

@Injectable()
export class InMemoryBuyerIdentityRepository implements BuyerIdentityRepository {
  private readonly identityIndex = new Map<string, string>();

  resolveGlobalUserId(merchantId: string, customer?: CustomerHints): string {
    const identityKey = CheckoutIdentityService.identityKey(merchantId, customer);
    if (!identityKey) return `usr_${crypto.randomUUID()}`;
    const existing = this.identityIndex.get(identityKey);
    if (existing) return existing;
    const created = `usr_${crypto.randomUUID()}`;
    this.identityIndex.set(identityKey, created);
    return created;
  }
}
