import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { BuyerChannelIdentityService, normalizeWhatsAppPhone } from "../services/buyer-channel-identity.service.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";
import { LinkBuyerWhatsAppUseCase } from "./link-buyer-whatsapp.use-case.js";
import type { IncomingMessageInput } from "../../../whatsapp-channel/application/use-cases/handle-incoming-message.use-case.js";
import type { WhatsAppConversationState, WhatsAppStructuredResponse, StoreUiAction } from "../../../whatsapp-channel/domain/ui/meta-ui.types.js";

interface LinkChallenge {
  version: 1; buyerId: string; merchantId: string; configId: string; phone: string; emailHint: string;
  phase: "pending" | "confirmed" | "cancelled"; verificationId?: string;
}

/** The website issues an opaque capability. Possession alone never binds a phone:
 * the official inbound sender must explicitly confirm the current native action. */
@Injectable()
export class BuyerInboundWhatsAppLinkUseCase {
  constructor(private readonly identities: BuyerChannelIdentityService,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly accounts: BuyerAccountRepository,
    @Optional() private readonly links?: LinkBuyerWhatsAppUseCase) {}

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
          await tx.buyerPhoneOtp.updateMany({ where: { id: old.id, consumedAt: null, codeHash: old.codeHash }, data: { consumedAt: new Date(), codeHash: JSON.stringify({ ...previous, phase: "cancelled" }) } });
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
    if (confirmed) {
      if (!this.links || !data.verificationId) throw new ServiceUnavailableException("whatsapp_link_reconciliation_unavailable");
      await this.links.reconcileConfirmedPhone(buyerId, data.phone, data.verificationId);
    }
    return { status: confirmed ? "confirmed" : data.phase === "cancelled" ? "cancelled" : record.expiresAt.getTime() <= Date.now() ? "expired" : "pending",
      linked: confirmed, phone: confirmed ? "+55 (***) *****-" + data.phone.slice(-4) : null };
  }

  async handle(input: IncomingMessageInput, state: WhatsAppConversationState): Promise<WhatsAppStructuredResponse | undefined> {
    const selected = input.interactiveId ? state.selections?.[input.interactiveId] : undefined;
    const action = selected?.kind === "message" ? selected.message : "";
    const initial = /^Vincular minha conta ([A-Za-z0-9_-]{43})$/.exec(input.body.trim());
    const confirmation = /^(confirmar_vinculo|cancelar_vinculo) ([A-Za-z0-9_-]{43})$/.exec(action);
    if (!initial && !confirmation && !/^(?:Vincular minha conta|confirmar_vinculo|cancelar_vinculo)\b/i.test(input.body.trim())) return;
    const reply = (message: string, choices: Array<{ label: string; action: StoreUiAction }> = []): WhatsAppStructuredResponse => ({
      merchantName: "Sua conta", agentMessage: message, quickReplies: [], state: { ...state, expectsFreeInput: false },
      blocks: [{ type: "account_link_actions", data: { choices } }] });
    try {
      if ((!initial && !confirmation) || input.metaMedia || input.catalogOrder || input.flowResponse) throw new UnauthorizedException("whatsapp_link_invalid");
      const token = initial?.[1] ?? confirmation![2]!, key = this.key(token);
      const result = await this.identities.prisma.$transaction(async tx => {
        const claim = input.inboxClaim;
        if (!claim || input.provider !== "META_CLOUD" || !input.deviceId.startsWith("META_CLOUD:") || claim.kind !== "message"
          || claim.merchantId !== input.merchantId || claim.configId !== input.deviceId.slice(11) || claim.deviceId !== input.deviceId)
          throw new UnauthorizedException("whatsapp_link_sender_required");
        const lock = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM whatsapp_webhook_inbox
          WHERE id=${claim.id} AND status='processing' AND lease_token=${claim.leaseToken} AND lease_expires_at>now() FOR UPDATE`;
        if (lock.length !== 1) throw new UnauthorizedException("whatsapp_link_sender_required");
        const inbox = await tx.whatsAppWebhookInbox.findUniqueOrThrow({ where: { id: claim.id } });
        const { inboxClaim: _claim, ...envelope } = input;
        if (inbox.merchantId !== input.merchantId || inbox.configId !== claim.configId || inbox.deviceId !== input.deviceId
          || !isDeepStrictEqual(inbox.payload, envelope) || Date.now() - input.timestamp > 24 * 3600_000 || input.timestamp > Date.now() + 60_000)
          throw new UnauthorizedException("whatsapp_link_sender_required");
        await tx.$queryRaw`SELECT phone FROM buyer_phone_otps WHERE phone=${key} FOR UPDATE`;
        const record = await tx.buyerPhoneOtp.findUnique({ where: { phone: key } });
        if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException("whatsapp_link_expired");
        const data = this.parse(record.codeHash), phone = normalizeWhatsAppPhone(input.fromNumber);
        if (data.phase !== "pending" || data.phone !== phone || data.merchantId !== input.merchantId || data.configId !== claim.configId)
          throw new UnauthorizedException("whatsapp_link_scope_invalid");
        const config = await tx.whatsAppChannelConfig.findFirst({ where: { id: data.configId, merchantId: data.merchantId, enabled: true, provider: "META_CLOUD", status: "ACTIVE" } });
        const native = await tx.whatsAppSession.findFirst({ where: { merchantId: data.merchantId, deviceId: input.deviceId,
          buyerPhone: { in: [phone, "+" + phone] }, status: "active", conversationState: { path: ["conversationId"], equals: state.conversationId } } });
        const buyer = await tx.buyerAccount.findUnique({ where: { globalUserId: data.buyerId } });
        if (!config || !native || !buyer || buyer.email.endsWith("@buyer.aacp")) throw new UnauthorizedException("whatsapp_link_scope_invalid");
        if (initial) return { data, phase: "prompt" as const, token };
        const persisted = native.conversationState as unknown as WhatsAppConversationState;
        const storedAction = input.interactiveId ? persisted.selections?.[input.interactiveId] : undefined;
        if (!input.interactiveId || storedAction?.kind !== "message" || storedAction.message !== action) throw new UnauthorizedException("whatsapp_link_current_action_required");
        if (confirmation![1] === "cancelar_vinculo") {
          await tx.buyerPhoneOtp.update({ where: { id: record.id }, data: { consumedAt: new Date(), codeHash: JSON.stringify({ ...data, phase: "cancelled" }) } });
          return { data, phase: "cancelled" as const, token };
        }
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`buyer-phone:${phone}`},0))::text`;
        const verificationId = await this.identities.bind(tx, data.buyerId, phone, randomUUID());
        await tx.buyerPhoneOtp.update({ where: { id: record.id }, data: { consumedAt: new Date(), attempts: 1,
          codeHash: JSON.stringify({ ...data, phase: "confirmed", verificationId }) } });
        return { data: { ...data, verificationId }, phase: "confirmed" as const, token };
      });
      if (result.phase === "prompt") return reply(`*Vincular sua conta*\n\nVocê está vinculando este WhatsApp à conta *${result.data.emailHint}* do site.\n\nConfirme apenas se você iniciou essa solicitação no site. O vínculo permite usar a mesma conta nos dois canais. Isso não autoriza mensagens promocionais.`, [
        { label: "Confirmar vínculo", action: { kind: "message", message: "confirmar_vinculo " + result.token } },
        { label: "Cancelar vínculo", action: { kind: "message", message: "cancelar_vinculo " + result.token } },
      ]);
      if (result.phase === "cancelled") return reply("Solicitação cancelada. Este WhatsApp não foi vinculado à conta solicitada.");
      return reply("✅ *WhatsApp confirmado*\n\nVolte ao site para concluir a atualização da sua conta. O vínculo não autoriza mensagens promocionais.");
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof UnauthorizedException || error instanceof ForbiddenException || error instanceof ConflictException)
        return reply("Não foi possível confirmar este vínculo. A solicitação pode ter expirado, já ter sido usada ou pertencer a outro número ou conta. Volte ao site para conferir e iniciar novamente.");
      throw error;
    }
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
