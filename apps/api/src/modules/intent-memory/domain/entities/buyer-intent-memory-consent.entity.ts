/**
 * BuyerIntentMemoryConsent Entity
 * LGPD Art. 8 (explicit consent), Art. 7 (withdrawal)
 *
 * Invariant: Consent must be (opted_in=true AND expires_at > now) to be active.
 * Annual re-consent: expires_at set to 1 year from opt-in date.
 */

import type { BuyerIntentMemoryConsent } from "@zyon/shared-types";

export class BuyerIntentMemoryConsentEntity {
  private readonly data: BuyerIntentMemoryConsent;

  private constructor(data: BuyerIntentMemoryConsent) {
    this.data = data;
  }

  static create(input: BuyerIntentMemoryConsent): BuyerIntentMemoryConsentEntity {
    const now = new Date();
    const expiresAt = input.expires_at
      ? new Date(input.expires_at)
      : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    return new BuyerIntentMemoryConsentEntity({
      ...input,
      expires_at: expiresAt.toISOString()
    });
  }

  static rehydrate(input: BuyerIntentMemoryConsent): BuyerIntentMemoryConsentEntity {
    return new BuyerIntentMemoryConsentEntity(input);
  }

  isActive(): boolean {
    const now = new Date();
    const expiresAt = new Date(this.data.expires_at);
    return this.data.opted_in && expiresAt > now;
  }

  get opted_in(): boolean { return this.data.opted_in; }
  get expires_at(): string { return this.data.expires_at; }
  get merchant_id(): string { return this.data.merchant_id; }
  get global_user_id(): string { return this.data.global_user_id; }

  snapshot(): BuyerIntentMemoryConsent {
    return { ...this.data };
  }
}
