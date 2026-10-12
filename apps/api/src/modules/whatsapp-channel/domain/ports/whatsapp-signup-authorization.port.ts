export const WHATSAPP_SIGNUP_AUTHORIZATION = Symbol("WhatsAppSignupAuthorization");
export interface MetaCloudAuthorizedAssets {
  accessToken: string;
  tokenExpiresAt?: Date;
  wabaId: string;
  phoneNumberId: string;
  whatsappNumber: string;
  phoneRegistered?: boolean;
}
export interface WhatsAppSignupAuthorization {
  authorize(input: { code: string; wabaId: string; phoneNumberId: string }): Promise<MetaCloudAuthorizedAssets>;
  subscribe(input: Pick<MetaCloudAuthorizedAssets, "accessToken" | "wabaId">): Promise<void>;
  isSubscribed(input: Pick<MetaCloudAuthorizedAssets, "accessToken" | "wabaId">): Promise<boolean>;
  registerPhone(input: Pick<MetaCloudAuthorizedAssets, "accessToken" | "phoneNumberId">, pin: string): Promise<void>;
  isPhoneRegistered(input: Pick<MetaCloudAuthorizedAssets, "accessToken" | "phoneNumberId">): Promise<boolean>;
}
