import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { AuthMerchant, AuthUser } from "../domain/auth.types.js";
import { createHash } from "node:crypto";
import type { AuthRepository, SessionRecord } from "../domain/ports/auth-repository.port.js";
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
  authVersion?: number;
  disabledAt?: Date | null;
  oauthProvider?: string | null;
  oauthProviderId?: string | null;
}): AuthUser {
  return {
    id: row.id,
    merchantId: row.merchantId,
    email: row.email,
    passwordHash: row.passwordHash ?? undefined,
    role: row.role.toLowerCase() as AuthUser["role"],
    authVersion: row.authVersion ?? 0,
    disabledAt: row.disabledAt ?? undefined,
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
              role: "owner",
              teamMembers: { create: { merchantId: input.merchantId, role: "OWNER" } }
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
              teamMembers: { create: { merchantId: input.merchantId, role: "OWNER" } },
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

  private hash(token: string): string { return createHash("sha256").update(token).digest("hex"); }

  async createSession(input: SessionRecord): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchant_users WHERE id = ${input.userId} FOR UPDATE`;
      const user = await tx.merchantUser.findUnique({ where: { id: input.userId } });
      if (!user || user.disabledAt || user.merchantId !== input.merchantId || user.authVersion !== input.authVersion ||
        user.role.toLowerCase() !== input.role || user.email !== input.email) return false;
      await tx.merchantAuthSession.create({ data: this.sessionData(input) });
      return true;
    });
  }

  private sessionData(input: SessionRecord) {
    return { id: input.id, familyId: input.familyId, userId: input.userId, merchantId: input.merchantId,
      authVersion: input.authVersion, refreshExpiresAt: input.refreshExpiresAt };
  }

  async findActiveSession(id: string, now: Date): Promise<SessionRecord | undefined> {
    const row = await this.prisma.merchantAuthSession.findUnique({ where: { id }, include: { user: true } });
    if (!row || row.consumedAt || row.revokedAt || row.refreshExpiresAt <= now || row.user.disabledAt ||
      row.authVersion !== row.user.authVersion || row.merchantId !== row.user.merchantId) return undefined;
    return { ...row, email: row.user.email, role: row.user.role.toLowerCase() as AuthUser["role"],
      consumedAt: undefined, revokedAt: undefined };
  }

  async rotateSession(id: string, replacement: SessionRecord, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchant_users WHERE id = ${replacement.userId} FOR UPDATE`;
      const user = await tx.merchantUser.findUnique({ where: { id: replacement.userId } });
      if (!user || user.disabledAt || user.authVersion !== replacement.authVersion ||
        user.merchantId !== replacement.merchantId || user.role.toLowerCase() !== replacement.role) return false;
      const old = await tx.merchantAuthSession.findUnique({ where: { id } });
      if (!old || old.userId !== replacement.userId || old.familyId !== replacement.familyId ||
        old.refreshExpiresAt <= now || old.refreshExpiresAt.getTime() !== replacement.refreshExpiresAt.getTime() || old.revokedAt) return false;
      // A consumed token is an invalid replay. Keep the committed winner usable: parallel
      // browser refresh requests must not revoke a newly-issued family member.
      const claim = await tx.merchantAuthSession.updateMany({ where: { id, consumedAt: null, revokedAt: null,
        authVersion: user.authVersion, refreshExpiresAt: { gt: now } }, data: { consumedAt: now } });
      if (claim.count !== 1) return false;
      await tx.merchantAuthSession.create({ data: this.sessionData(replacement) });
      return true;
    });
  }

  async revokeSessionFamily(id: string, userId: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchant_users WHERE id = ${userId} FOR UPDATE`;
      const session = await tx.merchantAuthSession.findUnique({ where: { id } });
      if (session?.userId !== userId) return;
      await tx.merchantAuthSession.updateMany({ where: { userId, familyId: session.familyId, revokedAt: null }, data: { revokedAt: now } });
    });
  }

  async storePasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchant_users WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.merchantUser.findUnique({ where: { id: userId } });
      if (!user || user.disabledAt) return;
      await tx.merchantPasswordResetToken.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.merchantPasswordResetToken.create({ data: { tokenHash: this.hash(token), userId, expiresAt, authVersion: user.authVersion } });
    });
  }

  async findPasswordResetToken(token: string) {
    const row = await this.prisma.merchantPasswordResetToken.findUnique({ where: { tokenHash: this.hash(token) } });
    return row && !row.consumedAt ? { userId: row.userId, token, expiresAt: row.expiresAt } : undefined;
  }

  async deletePasswordResetToken(token: string): Promise<void> {
    await this.prisma.merchantPasswordResetToken.updateMany({ where: { tokenHash: this.hash(token), consumedAt: null }, data: { consumedAt: new Date() } });
  }

  async consumePasswordReset(token: string, passwordHash: string, now: Date): Promise<boolean> {
    const tokenHash = this.hash(token);
    return this.prisma.$transaction(async tx => {
      const reset = await tx.merchantPasswordResetToken.findUnique({ where: { tokenHash } });
      if (!reset) return false;
      await tx.$queryRaw`SELECT id FROM merchant_users WHERE id = ${reset.userId} FOR UPDATE`;
      const user = await tx.merchantUser.findUnique({ where: { id: reset.userId } });
      if (!user || user.disabledAt || user.authVersion !== reset.authVersion) return false;
      const claim = await tx.merchantPasswordResetToken.updateMany({ where: { tokenHash, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (claim.count !== 1) return false;
      await tx.merchantUser.update({ where: { id: user.id }, data: { passwordHash, authVersion: { increment: 1 } } });
      await tx.merchantAuthSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.merchantPasswordResetToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
      return true;
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchant_users WHERE id = ${userId} FOR UPDATE`;
      await tx.merchantUser.update({ where: { id: userId }, data: { passwordHash, authVersion: { increment: 1 } } });
      await tx.merchantAuthSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.merchantPasswordResetToken.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
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
}

