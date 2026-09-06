import type { AuthMerchant, AuthUser } from "../domain/auth.types.js";
import type { AuthRepository, SessionRecord } from "../domain/ports/auth-repository.port.js";

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
        user.authVersion = (user.authVersion ?? 0) + 1;
        for (const [token, reset] of this.resetTokens) if (reset.userId === userId) this.resetTokens.delete(token);
        for (const session of this.sessions.values()) if (session.userId === userId) session.revokedAt = new Date();
        return;
      }
    }
  }

  private sessions = new Map<string, SessionRecord>();
  async createSession(input: SessionRecord): Promise<boolean> {
    const user = [...this.users.values()].find(u => u.id === input.userId);
    if (!user || user.disabledAt || (user.authVersion ?? 0) !== input.authVersion || user.role !== input.role) return false;
    this.sessions.set(input.id, { ...input });
    return true;
  }
  async findActiveSession(id: string, now: Date): Promise<SessionRecord | undefined> {
    const session = this.sessions.get(id);
    const user = [...this.users.values()].find(u => u.id === session?.userId);
    return session && !session.revokedAt && !session.consumedAt && session.refreshExpiresAt > now && user &&
      !user.disabledAt && (user.authVersion ?? 0) === session.authVersion ? { ...session } : undefined;
  }
  async rotateSession(id: string, replacement: SessionRecord, now: Date): Promise<boolean> {
    const current = this.sessions.get(id);
    const user = [...this.users.values()].find(u => u.id === replacement.userId);
    if (!current || current.consumedAt || current.revokedAt || current.refreshExpiresAt <= now || !user ||
      user.disabledAt || (user.authVersion ?? 0) !== replacement.authVersion) return false;
    current.consumedAt = now;
    this.sessions.set(replacement.id, { ...replacement });
    return true;
  }
  async revokeSessionFamily(id: string, userId: string, now: Date): Promise<void> {
    const current = this.sessions.get(id);
    if (current?.userId !== userId) return;
    for (const session of this.sessions.values()) if (session.familyId === current.familyId) session.revokedAt = now;
  }
  async consumePasswordReset(token: string, passwordHash: string, now: Date): Promise<boolean> {
    const reset = this.resetTokens.get(token);
    if (!reset || reset.expiresAt <= now) return false;
    this.resetTokens.delete(token);
    await this.updatePassword(reset.userId, passwordHash);
    return true;
  }

  private slugs = new Map<string, string>(); // slug → merchantId

  async isSlugTaken(slug: string): Promise<boolean> {
    return this.slugs.has(slug);
  }

  async setStoreSettings(merchantId: string, settings: Record<string, unknown>): Promise<void> {
    if (settings.slug) this.slugs.set(settings.slug as string, merchantId);
  }
}
