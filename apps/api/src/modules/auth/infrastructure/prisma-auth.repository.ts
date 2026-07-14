import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { AuthMerchant, AuthUser } from "../domain/auth.types.js";
import type { AuthRepository } from "../domain/ports/auth-repository.port.js";
import { EmailAlreadyRegisteredError, MerchantOwnerNotCreatedError } from "../domain/errors.js";

/**
 * L9: Mapper functions extracted from inline use.
 */
function toAuthUser(row: { id: string; merchantId: string; email: string; passwordHash: string; role: string }): AuthUser {
  return {
    id: row.id,
    merchantId: row.merchantId,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role as AuthUser["role"]
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

  async findUserByEmail(email: string): Promise<AuthUser | undefined> {
    const row = await this.prisma.merchantUser.findUnique({ where: { email } });
    return row ? toAuthUser(row) : undefined;
  }

  async findMerchantById(merchantId: string): Promise<AuthMerchant | undefined> {
    const row = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    return row ? toAuthMerchant(row) : undefined;
  }
}
