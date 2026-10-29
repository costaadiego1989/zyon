import { Inject, Injectable, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";

/** Phone possession locates an email challenge; it never authenticates the account. */
@Injectable()
export class WhatsAppCheckoutIdentityService {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyers: BuyerAccountRepository,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
  ) {}

  async emailHint(merchantId: string, buyer: { globalUserId: string; phone: string }): Promise<string | undefined> {
    const phones = brazilianPhoneForms(buyer.phone);
    const validEmail = (email: unknown): email is string => typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.endsWith("@buyer.aacp");
    // A merchant identity can locate an encrypted phone without scanning accounts.
    const linked = await this.buyers.findByGlobalUserId(buyer.globalUserId);
    if (linked?.phone && phones.some(phone => brazilianPhoneForms(linked.phone!).includes(phone)) && validEmail(linked.email)) return linked.email;
    for (const phone of phones) {
      const account = await this.buyers.findByPhone(phone);
      if (account?.phone && phones.some(form => brazilianPhoneForms(account.phone!).includes(form)) && validEmail(account.email)) return account.email;
    }
    // Prior checkout lookup is explicitly restricted to this merchant and phone.
    const prior = await this.prisma?.checkoutSession.findFirst({
      where: { merchantId, OR: phones.flatMap(phone => [
        { customer: { path: ["phone"], equals: phone } },
        { customer: { path: ["phone"], equals: "+" + phone } },
      ]), AND: [{ customer: { path: ["email_verified"], equals: true } }] },
      orderBy: { updatedAt: "desc" }, select: { customer: true },
    });
    const email = (prior?.customer as { email?: unknown } | undefined)?.email;
    return validEmail(email) ? email : undefined;
  }
}

function brazilianPhoneForms(input: string): string[] {
  const digits = input.replace(/\D/g, "");
  const international = digits.startsWith("55") && digits.length >= 12 ? digits : "55" + digits;
  const forms = [international, international.slice(2)];
  if (international.length === 13 && international[4] === "9") forms.push(international.slice(0, 4) + international.slice(5));
  if (international.length === 12 && /[6-9]/.test(international[4] ?? "")) forms.push(international.slice(0, 4) + "9" + international.slice(4));
  return [...new Set([...forms, ...forms.filter(phone => phone.startsWith("55") && phone.length >= 12).map(phone => phone.slice(2))])];
}
