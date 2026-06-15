import type { OnboardingStateEntity } from "../entities/onboarding-state.entity.js";

export const ONBOARDING_STATE_REPOSITORY = Symbol("ONBOARDING_STATE_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

export interface OnboardingStateRepository {
  /** Tenant-scoped read; null when the merchant has no persisted progress yet. */
  findByMerchant(merchantId: string): MaybePromise<OnboardingStateEntity | null>;
  /** Upsert by merchantId. */
  save(state: OnboardingStateEntity): MaybePromise<OnboardingStateEntity>;
}
