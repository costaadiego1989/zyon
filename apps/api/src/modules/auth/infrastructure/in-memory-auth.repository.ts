import type { AuthMerchant, AuthUser } from "../domain/auth.types.js";
import type { AuthRepository } from "../domain/ports/auth-repository.port.js";

/**
 * L8: Removed @Injectable() — test double, never wired via module root.
 * Constructed directly in specs, per CLAUDE.md.
 */
export class InMemoryAuthRepository implements AuthRepository {
  private merchants = new Map<string, AuthMerchant>();
  private users = new Map<string, AuthUser>();

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

  async findUserByEmail(email: string): Promise<AuthUser | undefined> {
    return this.users.get(email);
  }

  async findMerchantById(merchantId: string): Promise<AuthMerchant | undefined> {
    return this.merchants.get(merchantId);
  }
}
