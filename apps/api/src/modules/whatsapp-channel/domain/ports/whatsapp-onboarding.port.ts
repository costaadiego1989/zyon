import type { WhatsAppChannelConfigEntity } from "./whatsapp-config-repository.port.js";

export const WHATSAPP_ONBOARDING_STORE = Symbol("WhatsAppOnboardingStore");
export const TWILIO_ONBOARDING = Symbol("TwilioOnboarding");
export type ChannelPatch = Partial<Pick<WhatsAppChannelConfigEntity,
  "credentials" | "provider" | "status" | "enabled" | "whatsappNumber" | "connectedAt">>;

export interface OnboardingLease {
  token: string;
  config: WhatsAppChannelConfigEntity;
}
export interface WhatsAppOnboardingStore {
  claim(merchantId: string): Promise<OnboardingLease | null>;
  /** Fenced write; also reserves phone/WABA identity across merchants. */
  save(lease: OnboardingLease, patch: ChannelPatch): Promise<WhatsAppChannelConfigEntity>;
  release(lease: OnboardingLease): Promise<void>;
}

export interface TwilioAccount { accountSid: string; authToken: string }
export interface TwilioSender { sid: string; sender_id: string; status: string; configuration: { waba_id: string } }
export interface TwilioOnboarding {
  settings(): { configured: boolean; appId: string; configId: string; solutionId: string };
  parentAccountSid(): string;
  findAccount(merchantId: string): Promise<TwilioAccount | null>;
  createAccount(merchantId: string): Promise<TwilioAccount>;
  findSender(account: TwilioAccount, phone: string): Promise<TwilioSender | null>;
  createSender(account: TwilioAccount, phone: string, wabaId: string): Promise<TwilioSender>;
  getSender(account: TwilioAccount, sid: string): Promise<TwilioSender>;
  verifySender(account: TwilioAccount, sid: string, code: string): Promise<TwilioSender>;
}

/** Contains no provider body or credentials; safe for application error mapping. */
export class TwilioOnboardingError extends Error {
  constructor(readonly code: string, readonly uncertain = false) { super(code); }
}
