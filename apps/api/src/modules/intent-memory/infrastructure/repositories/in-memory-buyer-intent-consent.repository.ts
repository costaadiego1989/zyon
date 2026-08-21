import type { BuyerIntentMemoryConsent } from "@zyon/shared-types";
import type { BuyerIntentConsentRepositoryPort } from "../../domain/ports/intent-memory-repository.port.js";

export class InMemoryBuyerIntentConsentRepository implements BuyerIntentConsentRepositoryPort {
  private consents: BuyerIntentMemoryConsent[] = [];

  async saveConsent(consent: BuyerIntentMemoryConsent): Promise<void> {
    const idx = this.consents.findIndex(
      (c) => c.merchant_id === consent.merchant_id && c.global_user_id === consent.global_user_id
    );
    if (idx >= 0) {
      this.consents[idx] = consent;
    } else {
      this.consents.push(consent);
    }
  }

  async getConsent(merchantId: string, globalUserId: string): Promise<BuyerIntentMemoryConsent | null> {
    return (
      this.consents.find(
        (c) => c.merchant_id === merchantId && c.global_user_id === globalUserId
      ) ?? null
    );
  }

  async deleteConsent(merchantId: string, globalUserId: string): Promise<void> {
    this.consents = this.consents.filter(
      (c) => !(c.merchant_id === merchantId && c.global_user_id === globalUserId)
    );
  }
}
