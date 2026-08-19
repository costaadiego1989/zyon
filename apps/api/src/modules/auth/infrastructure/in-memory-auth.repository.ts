import type { AuthMerchant, AuthUser } from "../domain/auth.types.js";
import type { AuthRepository } from "../domain/ports/auth-repository.port.js";

/**
 * L8: Removed @Injectable() — test double, never wired via module root.
 * Constructed directly in specs, per CLAUDE.md.
 */
export class InMemoryAuthRepository implements AuthRepository {
  private merchants = new Map<string, AuthMerchant>();
  private users = new Map<string, AuthUser>();
  private oauthUsers = new Map<string, AuthUser>(); // provider:id -> user

  async createMerchantWithOwner(input: {
    merchantId: string;
    merchantName: string;
    email: string;
    passwordHash: string;
  }): Promise<{ merchant: AuthMerchant; user: AuthUser }> {
    const merchant = { id: input.merchantId, name: input.merchantName };
    const user = {
      id: `usr_${crypto.randomUUID()}`,
      merchantId: input.merchantId,
      email: input.email,
      passwordHash: input.passwordHash,
      role: "owner" as const
    };
    this.merchants.set(merchant.id, merchant);
    this.users.set(user.email, user);
    return { merchant, user };
  }

  async createMerchantWithOAuthOwner(input: {
    merchantId: string;
    merchantName: string;
    email: string;
    oauthProvider: string;
    oauthProviderId: string;
  }): Promise<{ merchant: AuthMerchant; user: AuthUser }> {
    const merchant = { id: input.merchantId, name: input.merchantName };
    const user = {
      id: `usr_${crypto.randomUUID()}`,
      merchantId: input.merchantId,
      email: input.email,
      role: "owner" as const,
      oauthProvider: input.oauthProvider,
      oauthProviderId: input.oauthProviderId,
    };
    this.merchants.set(merchant.id, merchant);
    this.users.set(user.email, user);
    this.oauthUsers.set(`${input.oauthProvider}:${input.oauthProviderId}`, user);
    return { merchant, user };
  }

  async findUserByEmail(email: string): Promise<AuthUser | undefined> {
    return this.users.get(email);
  }

  async findUserByOAuth(provider: string, providerId: string): Promise<AuthUser | undefined> {
    return this.oauthUsers.get(`${provider}:${providerId}`);
  }

  async linkOAuthToUser(userId: string, provider: string, providerId: string): Promise<void> {
    for (const user of this.users.values()) {
      if (user.id === userId) {
        user.oauthProvider = provider;
        user.oauthProviderId = providerId;
        this.oauthUsers.set(`${provider}:${providerId}`, user);
        return;
      }
    }
  }

  async findMerchantById(merchantId: string): Promise<AuthMerchant | undefined> {
    return this.merchants.get(merchantId);
  }

  private resetTokens = new Map<string, { userId: string; expiresAt: Date }>();

  async storePasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    this.resetTokens.set(token, { userId, expiresAt });
  }

  async findPasswordResetToken(token: string): Promise<{ userId: string; token: string; expiresAt: Date } | undefined> {
    const entry = this.resetTokens.get(token);
    if (!entry) return undefined;
    return { userId: entry.userId, token, expiresAt: entry.expiresAt };
  }

  async deletePasswordResetToken(token: string): Promise<void> {
    this.resetTokens.delete(token);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    for (const user of this.users.values()) {
      if (user.id === userId) {
        user.passwordHash = passwordHash;
        return;
      }
    }
  }

  private slugs = new Map<string, string>(); // slug → merchantId

  async isSlugTaken(slug: string): Promise<boolean> {
    return this.slugs.has(slug);
  }

  async setStoreSettings(merchantId: string, settings: Record<string, unknown>): Promise<void> {
    if (settings.slug) this.slugs.set(settings.slug as string, merchantId);
  }
}
