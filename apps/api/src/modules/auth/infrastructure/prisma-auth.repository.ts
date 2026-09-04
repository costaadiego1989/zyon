import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { AuthMerchant, AuthUser } from "../domain/auth.types.js";
import type { AuthRepository, OwnerProfile } from "../domain/ports/auth-repository.port.js";
import { EmailAlreadyRegisteredError, MerchantOwnerNotCreatedError } from "../domain/errors.js";

/**
 * L9: Mapper functions extracted from inline use.
 */
function toAuthUser(row: {
  id: string;
  merchantId: string;
  email: string;
  passwordHash: string | null;
  role: string;
  oauthProvider?: string | null;
  oauthProviderId?: string | null;
}): AuthUser {
  return {
    id: row.id,
    merchantId: row.merchantId,
    email: row.email,
    passwordHash: row.passwordHash ?? undefined,
    role: row.role as AuthUser["role"],
    oauthProvider: row.oauthProvider ?? undefined,
    oauthProviderId: row.oauthProviderId ?? undefined,
  };
}

function toAuthMerchant(row: { id: string; name: string }): AuthMerchant {
  return {
    id: row.id,
    name: row.name
  };
}

// In-memory reset token store (production: add a DB table or use Redis with TTL).
// Adequate for MVP since tokens are short-lived (30min) and single-instance.
const resetTokens = new Map<string, { userId: string; expiresAt: Date }>();

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createMerchantWithOwner(input: {
    merchantId: string;
    merchantName: string;
    email: string;
    passwordHash: string;
  }): Promise<{ merchant: AuthMerchant; user: AuthUser }> {
    try {
      const created = await this.prisma.merchant.create({
        data: {
          id: input.merchantId,
          name: input.merchantName,
          billingSubscription: {
            create: {
              status: "trialing",
              trialEndsAt: new Date(Date.now() + 14 * 86_400_000)
            }
          },
          users: {
            create: {
              email: input.email,
              passwordHash: input.passwordHash,
              role: "owner"
            }
          }
        },
        include: { users: true }
      });

      // C2: Assert owner user was created — fail-safe against TOCTOU race
      if (created.users.length !== 1) {
        throw new MerchantOwnerNotCreatedError(input.merchantId);
      }

      return {
        merchant: toAuthMerchant(created),
        user: toAuthUser(created.users[0]!)
      };
    } catch (err: unknown) {
      // M1: Structural error code check instead of string sniffing
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const target = err.meta?.target as string[] | undefined;
        if (target?.includes("email")) {
          throw new EmailAlreadyRegisteredError(input.email);
        }
      }
      throw err;
    }
  }

  async createMerchantWithOAuthOwner(input: {
    merchantId: string;
    merchantName: string;
    email: string;
    oauthProvider: string;
    oauthProviderId: string;
  }): Promise<{ merchant: AuthMerchant; user: AuthUser }> {
    try {
      const created = await this.prisma.merchant.create({
        data: {
          id: input.merchantId,
          name: input.merchantName,
          billingSubscription: {
            create: {
              status: "trialing",
              trialEndsAt: new Date(Date.now() + 14 * 86_400_000)
            }
          },
          users: {
            create: {
              email: input.email,
              role: "owner",
              oauthProvider: input.oauthProvider,
              oauthProviderId: input.oauthProviderId,
            }
          }
        },
        include: { users: true }
      });

      if (created.users.length !== 1) {
        throw new MerchantOwnerNotCreatedError(input.merchantId);
      }

      return {
        merchant: toAuthMerchant(created),
        user: toAuthUser(created.users[0]!)
      };
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const target = err.meta?.target as string[] | undefined;
        if (target?.includes("email")) {
          throw new EmailAlreadyRegisteredError(input.email);
        }
      }
      throw err;
    }
  }

  async findUserByEmail(email: string): Promise<AuthUser | undefined> {
    const row = await this.prisma.merchantUser.findUnique({ where: { email } });
    return row ? toAuthUser(row) : undefined;
  }

  async findUserByOAuth(provider: string, providerId: string): Promise<AuthUser | undefined> {
    const row = await this.prisma.merchantUser.findFirst({
      where: { oauthProvider: provider, oauthProviderId: providerId },
    });
    return row ? toAuthUser(row) : undefined;
  }

  async linkOAuthToUser(userId: string, provider: string, providerId: string): Promise<void> {
    await this.prisma.merchantUser.update({
      where: { id: userId },
      data: { oauthProvider: provider, oauthProviderId: providerId },
    });
  }

  async findMerchantById(merchantId: string): Promise<AuthMerchant | undefined> {
    const row = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    return row ? toAuthMerchant(row) : undefined;
  }

  async storePasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    resetTokens.set(token, { userId, expiresAt });
  }

  async findPasswordResetToken(token: string): Promise<{ userId: string; token: string; expiresAt: Date } | undefined> {
    const entry = resetTokens.get(token);
    if (!entry) return undefined;
    return { userId: entry.userId, token, expiresAt: entry.expiresAt };
  }

  async deletePasswordResetToken(token: string): Promise<void> {
    resetTokens.delete(token);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.merchantUser.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async isSlugTaken(slug: string): Promise<boolean> {
    const match = await this.prisma.merchant.findFirst({
      where: {
        storeSettings: { path: ["slug"], equals: slug },
      },
      select: { id: true },
    });
    return !!match;
  }

  async setStoreSettings(merchantId: string, settings: Record<string, unknown>): Promise<void> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { storeSettings: true },
    });
    const existing = (merchant?.storeSettings as Record<string, unknown>) ?? {};
    await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { storeSettings: { ...existing, ...settings } as any },
    });
  }

  async getOwnerProfile(merchantId: string) {
    const owner = await this.prisma.merchantUser.findFirst({
      where: { merchantId, role: { in: ["owner", "admin"] } },
      orderBy: { createdAt: "asc" },
    });
    if (!owner) return undefined;

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { storeSettings: true },
    });
    const settings = (merchant?.storeSettings as Record<string, unknown>) ?? {};

    return {
      userId: owner.id,
      merchantId,
      email: owner.email,
      ownerName: (settings["owner_name"] as string) ?? "",
      ownerPhone: (settings["owner_phone"] as string) ?? "",
      role: owner.role as "owner" | "admin",
    };
  }

  async updateOwnerProfile(
    _userId: string,
    merchantId: string,
    profile: { ownerName: string; ownerPhone: string },
  ): Promise<void> {
    await this.setStoreSettings(merchantId, {
      owner_name: profile.ownerName,
      owner_phone: profile.ownerPhone,
    });
  }

  async updateUserEmail(userId: string, newEmail: string): Promise<void> {
    await this.prisma.merchantUser.update({
      where: { id: userId },
      data: { email: newEmail },
    });
  }
}

