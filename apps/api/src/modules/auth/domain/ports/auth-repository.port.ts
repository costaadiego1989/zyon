import type { AuthMerchant, AuthUser } from "../auth.types.js";

export const AUTH_REPOSITORY = Symbol("AUTH_REPOSITORY");

export interface PasswordResetRecord {
  userId: string;
  token: string;
  expiresAt: Date;
}

export interface OwnerProfile {
  userId: string;
  merchantId: string;
  email: string;
  ownerName: string;
  ownerPhone: string;
  role: AuthUser["role"];
}

export interface AuthRepository {
  createMerchantWithOwner(input: {
    merchantId: string;
    merchantName: string;
    email: string;
    passwordHash: string;
  }): Promise<{ merchant: AuthMerchant; user: AuthUser }>;
  findUserByEmail(email: string): Promise<AuthUser | undefined>;
  findMerchantById(merchantId: string): Promise<AuthMerchant | undefined>;
  storePasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<void>;
  findPasswordResetToken(token: string): Promise<PasswordResetRecord | undefined>;
  deletePasswordResetToken(token: string): Promise<void>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;

  // OAuth methods
  findUserByOAuth(provider: string, providerId: string): Promise<AuthUser | undefined>;
  createMerchantWithOAuthOwner(input: {
    merchantId: string;
    merchantName: string;
    email: string;
    oauthProvider: string;
    oauthProviderId: string;
  }): Promise<{ merchant: AuthMerchant; user: AuthUser }>;
  linkOAuthToUser(userId: string, provider: string, providerId: string): Promise<void>;

  // Slug management
  isSlugTaken(slug: string): Promise<boolean>;
  setStoreSettings(merchantId: string, settings: Record<string, unknown>): Promise<void>;

  // Owner profile (account settings)
  getOwnerProfile(merchantId: string): Promise<OwnerProfile | undefined>;
  updateOwnerProfile(
    userId: string,
    merchantId: string,
    profile: { ownerName: string; ownerPhone: string },
  ): Promise<void>;
  updateUserEmail(
    userId: string,
    newEmail: string,
  ): Promise<void>;
}
