import type { AuthMerchant, AuthUser } from "../domain/auth.types.js";
import type { AuthRepository, OwnerProfile } from "../domain/ports/auth-repository.port.js";

/**
 * L8: Removed @Injectable() — test double, never wired via module root.
 * Constructed directly in specs, per CLAUDE.md.
 */
export class InMemoryAuthRepository implements AuthRepository {
  private merchants = new Map<string, AuthMerchant>();
  private users = new Map<string, AuthUser>();
  private oauthUsers = new Map<string, AuthUser>(); // provider:id -> user
  private ownerProfiles = new Map<string, { ownerName: string; ownerPhone: string }>();
  private usedEmails = new Set<string>(); // for email uniqueness simulation

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
    this.usedEmails.add(input.email);
    return { merchant, user };
  }

  async createMerchantWithOAuthOwner(input: {
    merchantId: string;
    merchantName: string;
    ownerName?: string;
    email: string;
    oauthProvider: string;
    oauthProviderId: string;
  }): Promise<{ merchant: AuthMerchant; user: AuthUser }> {
    const merchant = { id: input.merchantId, name: input.merchantName, oauthRegistrationPending: true, ownerName: input.ownerName };
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
    this.usedEmails.add(input.email);
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
    const merchant = this.merchants.get(merchantId);
    if (merchant) {
      if (typeof settings.oauth_registration_pending === "boolean") {
        merchant.oauthRegistrationPending = settings.oauth_registration_pending;
      }
      if (typeof settings.owner_name === "string") merchant.ownerName = settings.owner_name;
    }
  }

  async getOwnerProfile(merchantId: string): Promise<OwnerProfile | undefined> {
    let owner: AuthUser | undefined;
    for (const u of this.users.values()) {
      if (u.merchantId === merchantId && (u.role === "owner" || u.role === "admin")) {
        if (!owner || owner.id > u.id) owner = u; // oldest
      }
    }
    if (!owner) return undefined;

    const profile = this.ownerProfiles.get(merchantId) ?? { ownerName: "", ownerPhone: "" };
    return {
      userId: owner.id,
      merchantId,
      email: owner.email,
      ownerName: profile.ownerName,
      ownerPhone: profile.ownerPhone,
      role: owner.role,
    };
  }

  async updateOwnerProfile(
    _userId: string,
    merchantId: string,
    profile: { ownerName: string; ownerPhone: string },
  ): Promise<void> {
    this.ownerProfiles.set(merchantId, {
      ownerName: profile.ownerName,
      ownerPhone: profile.ownerPhone,
    });
  }

  async updateUserEmail(userId: string, newEmail: string): Promise<void> {
    if (this.usedEmails.has(newEmail)) {
      const err = new Error("email_taken");
      (err as any).code = "P2002";
      throw err;
    }

    for (const [oldEmail, u] of this.users.entries()) {
      if (u.id === userId) {
        this.users.delete(oldEmail);
        u.email = newEmail;
        this.users.set(newEmail, u);
        this.usedEmails.delete(oldEmail);
        this.usedEmails.add(newEmail);
        return;
      }
    }
  }
}
