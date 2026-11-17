import { BadRequestException, ForbiddenException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { BuyerChannelIdentityService, normalizeWhatsAppPhone } from "../services/buyer-channel-identity.service.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";

interface LinkChallenge {
  version: 1; buyerId: string; merchantId: string; configId: string; phone: string; emailHint: string;
  phase: "pending" | "confirmed" | "cancelled"; verificationId?: string;
}

/** The website issues an opaque capability. Possession alone never binds a phone:
 * the official inbound sender must explicitly confirm the current native action. */
@Injectable()
export class BuyerInboundWhatsAppLinkUseCase {
  constructor(private readonly identities: BuyerChannelIdentityService,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly accounts: BuyerAccountRepository) {}

  async create(buyerId: string, phoneValue: unknown, merchantValue: unknown, buyerMerchantId?: string) {
    const merchantId = this.merchant(merchantValue, buyerMerchantId), phone = normalizeWhatsAppPhone(phoneValue);
    const buyer = await this.account(buyerId);
    const config = await this.config(merchantId);
    const canonical = (config.credentials as { canonicalChatNumber?: unknown } | null)?.canonicalChatNumber;
    const number = typeof canonical === "string" && /^[1-9]\d{7,14}$/.test(canonical)
      ? canonical : config.whatsappNumber?.replace(/\D/g, "");
    if (!number || !/^[1-9]\d{7,14}$/.test(number)) throw new ServiceUnavailableException("whatsapp_link_channel_unavailable");
    const token = randomBytes(32).toString("base64url"), key = this.key(token);
    const expiresAt = new Date(Date.now() + 300_000);
    const data: LinkChallenge = { version: 1, buyerId, merchantId, configId: config.id, phone,
      emailHint: buyer.email.replace(/(^.).*(@.*$)/, "$1***$2"), phase: "pending" };
    const rateKey = "link-inbound-rate:" + createHash("sha256").update(JSON.stringify([buyerId, merchantId])).digest("hex");
    await this.identities.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rateKey},0))::text`;
      const prior = await tx.buyerPhoneOtp.findUnique({ where: { phone: rateKey } });
      if (prior && Date.now() - prior.lastSentAt.getTime() < 60_000) throw new BadRequestException("whatsapp_link_resend_too_soon");
      if (prior) {
        const old = await tx.buyerPhoneOtp.findUnique({ where: { phone: prior.codeHash } });
        if (old && !old.consumedAt) {
          const previous = this.parse(old.codeHash);
          await tx.buyerPhoneOtp.update({ where: { id: old.id }, data: { consumedAt: new Date(), codeHash: JSON.stringify({ ...previous, phase: "cancelled" }) } });
        }
      }
      await tx.buyerPhoneOtp.create({ data: { phone: key, codeHash: JSON.stringify(data), expiresAt, maxAttempts: 1 } });
      await tx.buyerPhoneOtp.upsert({ where: { phone: rateKey }, create: { phone: rateKey, codeHash: key, expiresAt },
        update: { codeHash: key, expiresAt, lastSentAt: new Date() } });
    });
    const url = new URL("https://wa.me/" + number); url.searchParams.set("text", "Vincular minha conta " + token);
    return { token, url: url.href, expiresAt: expiresAt.toISOString(), phone: "***" + phone.slice(-4) };
  }

  async status(buyerId: string, token: unknown, buyerMerchantId?: string) {
    await this.account(buyerId);
    const record = await this.identities.prisma.buyerPhoneOtp.findUnique({ where: { phone: this.key(token) } });
    if (!record) throw new UnauthorizedException("whatsapp_link_invalid");
    const data = this.parse(record.codeHash);
    if (data.buyerId !== buyerId || buyerMerchantId && data.merchantId !== buyerMerchantId) throw new ForbiddenException("whatsapp_link_scope_invalid");
    const config = await this.config(data.merchantId);
    if (config.id !== data.configId) throw new ForbiddenException("whatsapp_link_scope_invalid");
    const confirmed = data.phase === "confirmed" && !!record.consumedAt && await this.identities.verifiedAccount(data.phone) === buyerId;
    return { status: confirmed ? "confirmed" : data.phase === "cancelled" ? "cancelled" : record.expiresAt.getTime() <= Date.now() ? "expired" : "pending",
      linked: confirmed, phone: confirmed ? "+55 (***) *****-" + data.phone.slice(-4) : null };
  }

  private key(token: unknown): string {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BadRequestException("whatsapp_link_invalid");
    return "link-inbound:" + createHash("sha256").update(token).digest("hex");
  }

  private parse(value: string): LinkChallenge {
    let data: LinkChallenge;
    try { data = JSON.parse(value); } catch { throw new UnauthorizedException("whatsapp_link_invalid"); }
    if (!data || data.version !== 1 || !["pending", "confirmed", "cancelled"].includes(data.phase)
      || ![data.buyerId, data.merchantId, data.configId, data.phone, data.emailHint].every(v => typeof v === "string" && v.length > 0 && v.length <= 256)
      || normalizeWhatsAppPhone(data.phone) !== data.phone) throw new UnauthorizedException("whatsapp_link_invalid");
    return data;
  }

  private async account(buyerId: string) {
    const buyer = await this.accounts.findByGlobalUserId(buyerId);
    if (!buyer || !buyer.email || buyer.email.endsWith("@buyer.aacp")) throw new UnauthorizedException("registered_buyer_required");
    return buyer;
  }

  private merchant(value: unknown, buyerMerchantId?: string): string {
    if (typeof value !== "string" || !value.trim() || value.length > 128) throw new BadRequestException("merchant_context_required");
    if (buyerMerchantId && buyerMerchantId !== value.trim()) throw new ForbiddenException("whatsapp_link_scope_invalid");
    return value.trim();
  }

  private async config(merchantId: string) {
    const config = await this.identities.prisma.whatsAppChannelConfig.findFirst({ where: { merchantId, provider: "META_CLOUD", enabled: true, status: "ACTIVE" } });
    if (!config) throw new ServiceUnavailableException("whatsapp_link_channel_unavailable");
    return config;
  }
}
