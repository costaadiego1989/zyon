import { Inject, Injectable, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import type { TrustedWhatsAppCheckoutBuyer } from "../../../checkout/application/services/trusted-checkout-buyer.js";
import { isCompleteBuyerAddress } from "../../../checkout/domain/services/buyer-recognition.js";
import type { WhatsAppConversationPort } from "../../domain/ports/whatsapp-conversation.port.js";

type VerifiedSender = NonNullable<Parameters<NonNullable<WhatsAppConversationPort["respondStore"]>>[0]["verifiedSender"]>;
export type VerifiedWhatsAppOwner = { merchantId: string; conversationId: string; phone: string };
export type WhatsAppBuyerRecognition = ({ status: "unrecognized" | "ambiguous" } | { status: "recognized"; buyer: TrustedWhatsAppCheckoutBuyer }) & { owner?: VerifiedWhatsAppOwner };

/** Account reuse requires the authenticated, leased Meta message, never a body phone hint. */
@Injectable()
export class WhatsAppCheckoutIdentityService {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyers: BuyerAccountRepository,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
  ) {}

  async recognize(input: { merchantId: string; conversationId: string; phone: string; emailHint?: string;
    verifiedSender?: VerifiedSender }): Promise<WhatsAppBuyerRecognition> {
    const noBuyer = { status: "unrecognized" as const };
    const proof = input.verifiedSender;
    if (!proof || !this.prisma || !this.buyers.findRegisteredByPhones || !proof.deviceId.startsWith("META_CLOUD:")) return noBuyer;
    const phones = brazilianPhoneForms(input.phone);
    if (!phones.includes(proof.fromNumber.replace(/\D/g, ""))) return noBuyer;
    const configId = proof.deviceId.slice(11);
    const [config, message, conversation] = await Promise.all([
      this.prisma.whatsAppChannelConfig.findFirst({ where: { id: configId, merchantId: input.merchantId,
        enabled: true, status: "ACTIVE", provider: "META_CLOUD" }, select: { id: true } }),
      this.prisma.whatsAppWebhookInbox.findFirst({ where: { id: proof.inboxId, merchantId: input.merchantId,
        configId, deviceId: proof.deviceId, kind: "message", status: "processing", leaseToken: proof.leaseToken,
        leaseExpiresAt: { gt: new Date() } }, select: { payload: true } }),
      this.prisma.whatsAppSession.findFirst({ where: { merchantId: input.merchantId, deviceId: proof.deviceId,
        buyerPhone: { in: phones.flatMap(phone => [phone, "+" + phone]) }, status: "active",
        conversationState: { path: ["conversationId"], equals: input.conversationId } }, select: { id: true } }),
    ]);
    const payload = message?.payload as { fromNumber?: string; provider?: string } | undefined;
    if (!config || !conversation || payload?.provider !== "META_CLOUD" ||
      payload.fromNumber?.replace(/\D/g, "") !== proof.fromNumber.replace(/\D/g, "")) return noBuyer;
    const owner = { merchantId: input.merchantId, conversationId: input.conversationId, phone: proof.fromNumber.replace(/\D/g, "") };
    // An email disambiguates accounts already belonging to this verified phone;
    // it never authorizes recognition of an account registered to another phone.
    const hint = input.emailHint?.trim().toLowerCase();
    let accounts = await this.buyers.findRegisteredByPhones(phones);
    if (accounts.length > 1 && hint && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hint)) {
      accounts = await this.buyers.findRegisteredByPhones(phones, hint);
    }
    if (accounts.length > 1) return { status: "ambiguous", owner };
    const account = accounts[0];
    if (!account?.phone || !brazilianPhoneForms(account.phone).some(phone => phones.includes(phone))) return { ...noBuyer, owner };
    const [addresses, preference] = await Promise.all([
      this.prisma.buyerAddress.findMany({ where: { globalUserId: account.globalUserId }, take: 2,
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
      this.prisma.buyerPreference.findUnique({ where: { globalUserId: account.globalUserId }, select: {
        purchasePreferencesConfigured: true, shippingPreference: true, paymentPreference: true } }),
    ]);
    const saved = addresses.find(address => address.isDefault) ?? (addresses.length === 1 ? addresses[0] : undefined);
    const candidate = saved ?? account.address;
    const address = candidate ? { zip: candidate.zip?.replace(/\D/g, ""), street: candidate.street, number: candidate.number,
      complement: candidate.complement ?? "", neighborhood: candidate.neighborhood, city: candidate.city, state: candidate.state } : undefined;
    const preferences = preference?.purchasePreferencesConfigured === true &&
      ["cheapest", "fastest"].includes(preference.shippingPreference) && ["pix", "card"].includes(preference.paymentPreference)
      ? { shipping: preference.shippingPreference as "cheapest" | "fastest", payment: preference.paymentPreference as "pix" | "card" } : undefined;
    return { status: "recognized", owner, buyer: { merchantId: input.merchantId, conversationId: input.conversationId,
      globalUserId: account.globalUserId, customer: { fullName: account.displayName, email: account.email,
        cpf: account.cpf, phone: proof.fromNumber.replace(/\D/g, ""), phone_verified: true, email_verified: false,
        recognized_buyer: true, isReturning: true, address, address_verified: isCompleteBuyerAddress(address) }, preferences } };
  }

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
