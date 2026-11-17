import { Inject, Injectable, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import type { TrustedWhatsAppCheckoutBuyer } from "../../../checkout/application/services/trusted-checkout-buyer.js";
import { isCompleteBuyerAddress } from "../../../checkout/domain/services/buyer-recognition.js";
import type { WhatsAppConversationPort } from "../../domain/ports/whatsapp-conversation.port.js";
import { BuyerAccount } from "../../../buyer-account/domain/entities/buyer-account.entity.js";

type VerifiedSender = NonNullable<Parameters<NonNullable<WhatsAppConversationPort["respondStore"]>>[0]["verifiedSender"]>;
export type VerifiedWhatsAppOwner = { merchantId: string; conversationId: string; phone: string };
export type WhatsAppBuyerRecognition = ({ status: "unrecognized" | "ambiguous" } | { status: "recognized"; buyer: TrustedWhatsAppCheckoutBuyer;
  greetingName?: string }) & { owner?: VerifiedWhatsAppOwner };

/** Account reuse requires the authenticated, leased Meta message, never a body phone hint. */
@Injectable()
export class WhatsAppCheckoutIdentityService {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyers: BuyerAccountRepository,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient,
  ) {}

  /** The leased sender was already authenticated by recognize(). Bind account
   * creation to its canonical merchant/phone identity, not the caller's ID. */
  async ensurePhoneOnlyHubAccount(input: { owner: VerifiedWhatsAppOwner; globalUserId: string; fullName?: string }) {
    if (!this.prisma || !this.buyers.createPhoneOnlyIfAbsent) return null;
    const binding = await this.prisma.buyerIdentity.findUnique({ where: { merchantId_identityKey: {
      merchantId: input.owner.merchantId, identityKey: `phone:${input.owner.phone}` } } });
    if (!binding || binding.globalUserId !== input.globalUserId) return null;
    const matches = new Map<string, BuyerAccount>();
    for (const phone of brazilianPhoneForms(input.owner.phone)) {
      const account = await this.buyers.findByPhone(phone);
      if (account && !account.email.endsWith("@buyer.aacp")) return null;
      if (account?.phone && brazilianPhoneForms(account.phone).some(value => brazilianPhoneForms(input.owner.phone).includes(value)))
        matches.set(account.globalUserId, account);
    }
    if (matches.size > 1) return null;
    if (matches.size === 1) return [...matches.values()][0]!;
    const now = new Date();
    const created = await this.buyers.createPhoneOnlyIfAbsent(new BuyerAccount({ globalUserId: binding.globalUserId,
      phone: input.owner.phone, email: `phone_${input.owner.phone}@buyer.aacp`, passwordHash: null,
      displayName: input.fullName?.trim().slice(0, 100) || "Cliente WhatsApp", createdAt: now, updatedAt: now }));
    return created?.email.endsWith("@buyer.aacp") && created.globalUserId === binding.globalUserId && created.phone
      && brazilianPhoneForms(created.phone).some(phone => brazilianPhoneForms(input.owner.phone).includes(phone)) ? created : null;
  }

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
    // A confirmed channel link is independent from the editable profile phone.
    // Resolve it only after proving this turn's current merchant/inbox/sender.
    const links = await this.prisma.buyerVerifiedPhone?.findMany({ where: {
      phone: { in: phones.filter(phone => phone.startsWith("55") && phone.length >= 12) },
    }, select: { buyerId: true } }) ?? [];
    const linkedIds = [...new Set(links.map(link => link.buyerId))];
    if (linkedIds.length > 1) return { status: "ambiguous", owner };
    const linkedId = linkedIds[0];
    const linkedAccount = linkedId ? await this.buyers.findByGlobalUserId(linkedId) : null;
    if (linkedId && (!linkedAccount || linkedAccount.email.endsWith("@buyer.aacp"))) return { ...noBuyer, owner };
    // An email disambiguates accounts already belonging to this verified phone;
    // it never authorizes recognition of an account registered to another phone.
    const hint = input.emailHint?.trim().toLowerCase();
    let accounts = linkedAccount ? [linkedAccount] : await this.buyers.findRegisteredByPhones(phones);
    if (accounts.length > 1) {
      if (!hint || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hint)) return { status: "ambiguous", owner };
      const selected = await this.buyers.findRegisteredByPhones(phones, hint);
      if (selected.length !== 1) return { status: "ambiguous", owner };
      accounts = selected;
    }
    if (!accounts.length && typeof this.buyers.findByPhone === "function") {
      const guests = new Map<string, BuyerAccount>();
      for (const phone of phones) {
        const guest = await this.buyers.findByPhone(phone);
        if (guest?.email.endsWith("@buyer.aacp") && guest.phone && brazilianPhoneForms(guest.phone).some(value => phones.includes(value)))
          guests.set(guest.globalUserId, guest);
      }
      if (guests.size > 1) return { status: "ambiguous", owner };
      accounts = [...guests.values()];
    }
    const account = accounts[0];
    if (!account || !linkedId && (!account.phone || !brazilianPhoneForms(account.phone).some(phone => phones.includes(phone)))) return { ...noBuyer, owner };
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
    // Phone-only accounts can retain their channel display name for a friendly
    // salutation. It is not a collected checkout name or account verification.
    return { status: "recognized", owner, greetingName: account.displayName, buyer: { merchantId: input.merchantId, conversationId: input.conversationId,
      globalUserId: account.globalUserId, customer: { fullName: account.email.endsWith("@buyer.aacp") ? undefined : account.displayName,
        email: account.email.endsWith("@buyer.aacp") ? undefined : account.email,
        cpf: account.cpf, phone: proof.fromNumber.replace(/\D/g, ""), phone_verified: true, email_verified: false,
        recognized_buyer: true, isReturning: true, address, address_verified: linkedId ? false : isCompleteBuyerAddress(address) }, preferences } };
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

export function brazilianPhoneForms(input: string): string[] {
  const digits = input.replace(/\D/g, "");
  const international = digits.startsWith("55") && digits.length >= 12 ? digits : "55" + digits;
  const forms = [international, international.slice(2)];
  if (international.length === 13 && international[4] === "9") forms.push(international.slice(0, 4) + international.slice(5));
  if (international.length === 12 && /[6-9]/.test(international[4] ?? "")) forms.push(international.slice(0, 4) + "9" + international.slice(4));
  return [...new Set([...forms, ...forms.filter(phone => phone.startsWith("55") && phone.length >= 12).map(phone => phone.slice(2))])];
}
