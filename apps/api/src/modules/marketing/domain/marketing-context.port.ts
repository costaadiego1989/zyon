export const MARKETING_CONTEXT = Symbol("MARKETING_CONTEXT");
export const MARKETING_CLOCK = Symbol("MARKETING_CLOCK");
export interface MarketingBuyer {
  id: string;
  name: string | null;
  email: string | null;
  verifiedPhone: string | null;
}
export interface MarketingContext {
  plan(merchantId: string): Promise<string>;
  buyer(accountId: string): Promise<MarketingBuyer | null>;
  verifiedAccount(phone: string): Promise<MarketingBuyer | null>;
  /** A newer global opt-out takes precedence over an older per-store grant. */
  blockedByPreference(
    accountId: string,
    consentAt: string,
    merchantId: string
  ): Promise<boolean>;
  blockedAccounts?(
    items: Array<{ accountId: string; consentAt: string }>,
    merchantId: string
  ): Promise<Set<string>>;
}
export interface MarketingClock {
  now(): Date;
}
