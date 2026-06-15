import type { PrismaClient } from "@prisma/client";
import type { AuthMerchant, AuthUser } from "../domain/auth.types.js";
import type { AuthRepository } from "../domain/ports/auth-repository.port.js";

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createMerchantWithOwner(input: {
    merchantId: string;
    merchantName: string;
    email: string;
    passwordHash: string;
  }): Promise<{ merchant: AuthMerchant; user: AuthUser }> {
    const created = await this.prisma.merchant.create({
      data: {
        id: input.merchantId,
        name: input.merchantName,
        billingSubscription: {
          create: {
            status: "trialing",
            trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
          },
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
    return {
      merchant: { id: created.id, name: created.name },
      user: toAuthUser(created.users[0]!)
    };
  }

  async findUserByEmail(email: string): Promise<AuthUser | undefined> {
    const row = await this.prisma.merchantUser.findUnique({ where: { email } });
    return row ? toAuthUser(row) : undefined;
  }

  async findMerchantById(merchantId: string): Promise<AuthMerchant | undefined> {
    const row = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    return row ? { id: row.id, name: row.name } : undefined;
  }
}

function toAuthUser(row: { id: string; merchantId: string; email: string; passwordHash: string; role: string }): AuthUser {
  return {
    id: row.id,
    merchantId: row.merchantId,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role as AuthUser["role"]
  };
}
