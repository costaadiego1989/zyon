import type { BuyerIntentMemoryConsent, CustomerIntentRecord } from "@zyon/shared-types";

export const INTENT_MEMORY_REPOSITORY = Symbol("INTENT_MEMORY_REPOSITORY");
export const BUYER_INTENT_CONSENT_REPOSITORY = Symbol("BUYER_INTENT_CONSENT_REPOSITORY");

export interface IntentMemoryRepositoryPort {
  save(record: CustomerIntentRecord): Promise<void>;
  getLatest(merchantId: string, globalUserId: string): Promise<CustomerIntentRecord | null>;
  findByMerchantId(merchantId: string): Promise<CustomerIntentRecord[]>;
}

export interface BuyerIntentConsentRepositoryPort {
  saveConsent(consent: BuyerIntentMemoryConsent): Promise<void>;
  getConsent(merchantId: string, globalUserId: string): Promise<BuyerIntentMemoryConsent | null>;
  deleteConsent(merchantId: string, globalUserId: string): Promise<void>;
}
