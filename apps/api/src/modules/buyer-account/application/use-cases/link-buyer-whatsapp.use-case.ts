import { BadRequestException, Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { BuyerChannelIdentityService, normalizeWhatsAppPhone } from "../services/buyer-channel-identity.service.js";
import { OTP_STORE, type OtpStore } from "../../domain/ports/otp-store.port.js";
import { SMS_PROVIDER, type SmsSender } from "../../domain/ports/sms.port.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { CashbackService } from "../../../cashback/application/cashback.service.js";

@Injectable()
export class LinkBuyerWhatsAppUseCase {
  constructor(
    private readonly identities: BuyerChannelIdentityService,
    @Inject(OTP_STORE) private readonly otp: OtpStore,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly accounts: BuyerAccountRepository,
    @Optional() @Inject(SMS_PROVIDER) private readonly sender?: SmsSender,
    @Optional() private readonly cashback?: CashbackService,
  ) {}

  async send(buyerId: string, value: unknown) {
    const phone = normalizeWhatsAppPhone(value);
    if (!await this.accounts.findByGlobalUserId(buyerId)) throw new UnauthorizedException("buyer_account_not_found");
    if (!this.sender) throw new ServiceUnavailableException("otp_sms_unavailable");
    const key = `link-whatsapp:${buyerId}:${phone}`;
    const active = await this.otp.findActive(key);
    if (active && active.expiresAt.getTime() > Date.now() + 240000) throw new BadRequestException("otp_resend_too_soon");
    const code = String(randomInt(100000, 1000000));
    try { await this.sender.send(phone, `Seu código para vincular o WhatsApp à sua conta é ${code}. Válido por 5 minutos. Não compartilhe.`); }
    catch { throw new ServiceUnavailableException("otp_sms_delivery_failed"); }
    await this.otp.save({ phone: key, codeHash: createHash("sha256").update(code).digest("hex"), maxAttempts: 5,
      expiresAt: new Date(Date.now() + 300000) });
    return { sent: true as const, delivered_to: `***${phone.slice(-4)}` };
  }

  async verify(buyerId: string, value: unknown, code: unknown) {
    const phone = normalizeWhatsAppPhone(value);
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw new BadRequestException("otp_invalid");
    if (!await this.accounts.findByGlobalUserId(buyerId)) throw new UnauthorizedException("buyer_account_not_found");
    let verificationId: string = randomUUID();
    const key = `link-whatsapp:${buyerId}:${phone}`;
    await this.identities.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`buyer-phone:${phone}`},0))::text`;
      const record = await this.otp.findActive(key);
      if (!record || record.attempts >= record.maxAttempts) throw new UnauthorizedException("otp_expired_or_locked");
      const supplied = createHash("sha256").update(code).digest();
      const expected = Buffer.from(record.codeHash, "hex");
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        await this.otp.incrementAttempts(key);
        throw new UnauthorizedException("otp_invalid");
      }
      verificationId = await this.identities.bind(tx, buyerId, phone, verificationId);
      await this.otp.consume(key);
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
