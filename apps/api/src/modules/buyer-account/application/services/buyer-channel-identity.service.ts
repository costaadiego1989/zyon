import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient, Prisma } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

export function normalizeWhatsAppPhone(value: unknown): string {
  if (typeof value !== "string" || value.length > 40) throw new BadRequestException("phone_invalid");
  const digits = value.replace(/\D/g, "");
  const phone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  if (!/^55[1-9]\d{9,10}$/.test(phone)) throw new BadRequestException("phone_invalid");
  return phone;
}

@Injectable()
export class BuyerChannelIdentityService {
  constructor(@Inject(PRISMA_CLIENT) public readonly prisma: PrismaClient) {}

  async verifiedAccount(phone: string): Promise<string | null> {
    let normalized: string;
    try { normalized = normalizeWhatsAppPhone(phone); }
    catch (error) { if (error instanceof BadRequestException) return null; throw error; }
    const rows = await this.prisma.$queryRaw<Array<{ buyer_id: string }>>`
      SELECT buyer_id FROM buyer_verified_phones WHERE phone=${normalized}`;
    return rows[0]?.buyer_id ?? null;
  }

  async status(buyerId: string): Promise<{ linked: boolean; phone: string | null }> {
    const rows = await this.prisma.$queryRaw<Array<{ phone: string }>>`
      SELECT phone FROM buyer_verified_phones WHERE buyer_id=${buyerId} ORDER BY verified_at DESC LIMIT 1`;
    const phone = rows[0]?.phone;
    return { linked: Boolean(phone), phone: phone ? `+55 (***) *****-${phone.slice(-4)}` : null };
  }

  async bind(tx: Prisma.TransactionClient, buyerId: string, phone: string, verificationId: string): Promise<string> {
    const existing = await tx.$queryRaw<Array<{ buyer_id: string; verification_id: string }>>`SELECT buyer_id,verification_id FROM buyer_verified_phones WHERE phone=${phone}`;
    if (existing[0] && existing[0].buyer_id !== buyerId) throw new ConflictException("phone_already_linked");
    if (existing[0]) return existing[0].verification_id;
    // No profile phone or caller supplied identity is proof of possession.
    await tx.$executeRaw`INSERT INTO buyer_verified_phones(phone,buyer_id,verification_id) VALUES(${phone},${buyerId},${verificationId})`;
    return verificationId;
  }
}
