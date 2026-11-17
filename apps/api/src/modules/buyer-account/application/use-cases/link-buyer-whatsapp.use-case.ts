import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { BuyerChannelIdentityService, normalizeWhatsAppPhone } from "../services/buyer-channel-identity.service.js";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";
import { SendWhatsAppMessageUseCase } from "../../../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { CashbackService } from "../../../cashback/application/cashback.service.js";

@Injectable()
export class LinkBuyerWhatsAppUseCase {
  constructor(
    private readonly identities: BuyerChannelIdentityService,
    @Inject(OTP_STORE) private readonly otp: OtpStore,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly accounts: BuyerAccountRepository,
    @Optional() @Inject(SendWhatsAppMessageUseCase) private readonly sender?: Pick<SendWhatsAppMessageUseCase, "execute">,
    @Optional() private readonly cashback?: CashbackService,
  ) {}

  async send(buyerId: string, value: unknown, merchantValue: unknown) {
    const merchantId = this.merchantId(merchantValue);
    const phone = normalizeWhatsAppPhone(value);
    if (!await this.accounts.findByGlobalUserId(buyerId)) throw new UnauthorizedException("buyer_account_not_found");
    if (!this.sender) throw new ServiceUnavailableException("otp_whatsapp_unavailable");
    const key = `link-whatsapp:${buyerId}:${phone}`;
    const active = await this.otp.findActive(key);
    if (active && active.expiresAt.getTime() > Date.now() + 240000) throw new BadRequestException("otp_resend_too_soon");
    const code = String(randomInt(100000, 1000000));
    try {
      const result = await this.sender.execute({ merchantId, type: "buyer_whatsapp_link_otp", toPhone: phone, variables: { otpCode: code } });
      if (result.channel !== "whatsapp_template" || result.status !== "sent" || !result.messageId?.trim()) {
        throw new ServiceUnavailableException("otp_whatsapp_delivery_unavailable");
      }
    } catch { throw new ServiceUnavailableException("otp_whatsapp_delivery_unavailable"); }
    await this.otp.save({ phone: key, codeHash: createHash("sha256").update(JSON.stringify([merchantId, code])).digest("hex"), maxAttempts: 5,
      expiresAt: new Date(Date.now() + 300000) });
    return { sent: true as const, delivered_to: `***${phone.slice(-4)}` };
  }

  async verify(buyerId: string, value: unknown, code: unknown, merchantValue: unknown) {
    const merchantId = this.merchantId(merchantValue);
    const phone = normalizeWhatsAppPhone(value);
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw new BadRequestException("otp_invalid");
    if (!await this.accounts.findByGlobalUserId(buyerId)) throw new UnauthorizedException("buyer_account_not_found");
    let verificationId: string = randomUUID();
    const key = `link-whatsapp:${buyerId}:${phone}`;
    await this.identities.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`buyer-phone:${phone}`},0))::text`;
      const record = await this.otp.findActive(key);
      if (!record || record.attempts >= record.maxAttempts) throw new UnauthorizedException("otp_expired_or_locked");
      const supplied = createHash("sha256").update(JSON.stringify([merchantId, code])).digest();
      const expected = Buffer.from(record.codeHash, "hex");
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        await this.otp.incrementAttempts(key);
        throw new UnauthorizedException("otp_invalid");
      }
      await this.otp.consume(key);
      verificationId = await this.identities.bind(tx, buyerId, phone, verificationId);
    });
    // Canonicalization is recoverable from the durable possession proof if the
    // process stops between this commit and a merchant's wallet migration.
    return this.repairWallets(buyerId, phone, verificationId);
  }

  /** Called only by the server-side login flow after it consumes a phone OTP. */
  async recordVerifiedPhone(buyerId: string, value: string) {
    const phone = normalizeWhatsAppPhone(value); let verificationId: string = randomUUID();
    await this.identities.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`buyer-phone:${phone}`},0))::text`;
      verificationId = await this.identities.bind(tx, buyerId, phone, verificationId);
    });
    return this.repairWallets(buyerId, phone, verificationId);
  }

  private merchantId(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 128) throw new BadRequestException("merchant_context_required");
    return value.trim();
  }

  /** Server-only reconciliation from an already committed possession proof. */
  async reconcileConfirmedPhone(buyerId: string, phone: string, verificationId: string) {
    const proofs = await this.identities.prisma.$queryRaw<Array<{ buyer_id: string; verification_id: string }>>`
      SELECT buyer_id,verification_id FROM buyer_verified_phones WHERE phone=${phone}`;
    if (proofs[0]?.buyer_id !== buyerId || proofs[0]?.verification_id !== verificationId) throw new UnauthorizedException("whatsapp_link_proof_required");
    return this.repairWallets(buyerId, phone, verificationId);
  }

  private async repairWallets(buyerId: string, phone: string, verificationId: string) {
    const previous = await this.identities.prisma.buyerIdentity.findMany({ where: { identityKey: `phone:${phone}` } });
    for (const row of previous) if (row.globalUserId !== buyerId) {
      if (!this.cashback) throw new ServiceUnavailableException("cashback_identity_reconciliation_required");
      await this.cashback.linkVerifiedIdentity({ merchantId: row.merchantId, previousBuyerId: row.globalUserId,
        canonicalBuyerId: buyerId, verificationId });
    }
    return this.identities.status(buyerId);
  }
}
