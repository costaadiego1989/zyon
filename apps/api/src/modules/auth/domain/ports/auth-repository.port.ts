import type { AuthMerchant, AuthUser } from "../auth.types.js";

export const AUTH_REPOSITORY = Symbol("AUTH_REPOSITORY");

export interface PasswordResetRecord {
  userId: string;
  token: string;
  expiresAt: Date;
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
}
