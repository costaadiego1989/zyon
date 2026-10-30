import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { MelhorEnvioWallet, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../notifications/domain/ports/email-sender.port.js";
import { MELHOR_ENVIO_TOKEN_RESOLVER, type MelhorEnvioTokenResolver } from "../domain/ports/melhor-envio-token-resolver.port.js";
import { lowWalletContent, ShippingWalletError, WALLET_CHECK_INTERVAL_MS, WALLET_MIN_REFRESH_MS, walletLocation } from "../domain/shipping-wallet.js";
import { SHIPPING_WALLET_PROVIDER, type ShippingWalletProvider } from "../domain/ports/shipping-wallet-provider.port.js";

export interface ShippingWalletAlertSettings { enabled: boolean; thresholdCents: number; emailEnabled: boolean }

@Injectable()
export class ShippingWalletService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(MELHOR_ENVIO_TOKEN_RESOLVER) private readonly tokens: MelhorEnvioTokenResolver,
    @Inject(EMAIL_SENDER_PORT) private readonly email: EmailSenderPort,
    @Inject(SHIPPING_WALLET_PROVIDER) private readonly provider: ShippingWalletProvider,
  ) {}

  private async merchant(merchantId: string) {
    if (!merchantId?.trim()) throw new NotFoundException("merchant_not_found");
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: {
      id: true, melhorEnvioEnabled: true, melhorEnvioAccessToken: true, melhorEnvioRefreshToken: true,
      users: { where: { role: { in: ["owner", "OWNER"] }, disabledAt: null }, orderBy: { createdAt: "asc" }, take: 1, select: { email: true } },
    } });
    if (!merchant) throw new NotFoundException("merchant_not_found");
    return merchant;
  }

  async get(merchantId: string, refresh = false) {
    const location = this.provider.location();
    const { base } = location;
    let merchant = await this.merchant(merchantId);
    let row = await this.prisma.melhorEnvioWallet.upsert({
      where: { merchantId_environment: { merchantId, environment: location.environment } },
      create: { merchantId, environment: location.environment }, update: { environment: location.environment },
    });
    if (merchant.melhorEnvioEnabled && merchant.melhorEnvioAccessToken && merchant.melhorEnvioRefreshToken) {
      const now = new Date();
      const due = !row.checkedAt || now.getTime() - row.checkedAt.getTime() >= (refresh ? WALLET_MIN_REFRESH_MS : 60_000);
      if (due || row.lastErrorCode) {
        await this.refresh(row, base);
        row = await this.prisma.melhorEnvioWallet.findUniqueOrThrow({ where: { id: row.id } });
        merchant = await this.merchant(merchantId);
      }
    }
    const status = !merchant.melhorEnvioEnabled ? "inactive" :
      !merchant.melhorEnvioAccessToken || !merchant.melhorEnvioRefreshToken ? "disconnected" :
      row.lastErrorCode ? "unavailable" : row.checkedAt ? "ready" : "pending";
    return {
      status, environment: location.environment, rechargeUrl: location.rechargeUrl,
      balanceCents: status === "ready" ? row.balanceCents : null,
      reservedCents: status === "ready" ? row.reservedCents : null,
      debtsCents: status === "ready" ? row.debtsCents : null,
      checkedAt: row.checkedAt?.toISOString() ?? null,
      errorCode: status === "unavailable" ? row.lastErrorCode : null,
      stale: !!row.checkedAt && Date.now() - row.checkedAt.getTime() > WALLET_CHECK_INTERVAL_MS,
      alert: { enabled: row.alertEnabled, thresholdCents: row.thresholdCents, emailEnabled: row.emailEnabled },
      emailRecipient: merchant.users[0]?.email ?? null,
      emailDeliveryFailed: row.emailPending && (row.emailAttempts >= 5 || !!row.emailStartedAt && Date.now() - row.emailStartedAt.getTime() > 23 * 3600_000),
      lowBalance: status === "ready" && row.alertEnabled && row.balanceCents !== null && row.balanceCents < row.thresholdCents,
    };
  }

  async configure(merchantId: string, input: ShippingWalletAlertSettings) {
    if (!input || typeof input.enabled !== "boolean" || typeof input.emailEnabled !== "boolean" ||
      !Number.isSafeInteger(input.thresholdCents) || input.thresholdCents < 1 || input.thresholdCents > 5_000_000) {
      throw new BadRequestException("wallet_alert_settings_invalid");
    }
    const merchant = await this.merchant(merchantId);
    if (input.emailEnabled && !merchant.users[0]?.email) throw new BadRequestException("wallet_owner_email_unavailable");
    const { environment } = this.provider.location();
    const settings = { alertEnabled: input.enabled, thresholdCents: input.thresholdCents, emailEnabled: input.emailEnabled };
    const row = await this.prisma.melhorEnvioWallet.upsert({
      where: { merchantId_environment: { merchantId, environment } },
      create: { merchantId, environment }, update: { environment },
    });
    const changed = await this.prisma.$transaction(async tx => {
      await tx.melhorEnvioWallet.updateMany({ where: { id: row.id }, data: { updatedAt: new Date() } });
      const previous = await tx.melhorEnvioWallet.findUniqueOrThrow({ where: { id: row.id } });
      if (previous.alertEnabled === input.enabled && previous.thresholdCents === input.thresholdCents && previous.emailEnabled === input.emailEnabled) return false;
      const resetEpisode = previous.alertEnabled !== input.enabled || previous.thresholdCents !== input.thresholdCents;
      // Compare while holding the row lock: identical concurrent saves keep the episode.
      await tx.melhorEnvioWallet.update({ where: { id: row.id }, data: {
        ...settings, leaseToken: null, leaseUntil: null, lastAttemptAt: null, checkedAt: null,
        ...(resetEpisode ? { lowBalance: false, alertId: null, emailPending: false, emailAttempts: 0, emailStartedAt: null, emailSentAt: null, emailRecipient: null } : {
          emailPending: input.emailEnabled && previous.lowBalance && !previous.emailSentAt,
          emailRecipient: previous.emailAttempts > 0 ? previous.emailRecipient : input.emailEnabled ? merchant.users[0]?.email : null,
        }),
      } });
      return true;
    });
    return this.get(merchantId, changed);
  }

  async refresh(row: MelhorEnvioWallet, base = this.provider.location().base) {
    const now = new Date();
    const leaseToken = randomUUID();
    const claim = await this.prisma.melhorEnvioWallet.updateMany({ where: {
      id: row.id, environment: walletLocation(base).environment,
      AND: [
        { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        { OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: new Date(now.getTime() - WALLET_MIN_REFRESH_MS) } }] },
      ],
    }, data: { leaseToken, leaseUntil: new Date(now.getTime() + 120_000), lastAttemptAt: now } });
    if (!claim.count) return;
    try {
      const token = await this.tokens.resolveToken(row.merchantId, { allowPlatformFallback: false });
      if (!token) throw new ShippingWalletError("reconnect_required");
      const account = await this.merchant(row.merchantId);
      if (!account.melhorEnvioEnabled || !account.melhorEnvioAccessToken || !account.melhorEnvioRefreshToken) return;
      if (!this.provider.matchesCredential(account.melhorEnvioAccessToken, token)) return;
      const balance = await this.provider.read(base, token);
      await this.prisma.$transaction(async tx => {
        // This lock serializes observations, configuration changes and reconnects.
        const lock = await tx.melhorEnvioWallet.updateMany({ where: { id: row.id, leaseToken }, data: { leaseToken } });
        if (!lock.count) return;
        const currentAccount = await tx.merchant.findFirst({ where: {
          id: row.merchantId, melhorEnvioEnabled: true, melhorEnvioAccessToken: account.melhorEnvioAccessToken,
        }, select: { id: true } });
        if (!currentAccount) return;
        const current = await tx.melhorEnvioWallet.findUniqueOrThrow({ where: { id: row.id } });
        const low = current.alertEnabled && balance.balanceCents < current.thresholdCents;
        const started = low && !current.lowBalance;
        const alertId = started ? randomUUID() : low ? current.alertId : null;
        const recipient = account.users[0]?.email ?? null;
        if (started && alertId) await tx.merchantNotification.create({ data: {
          id: `shipping-wallet-${alertId}`, merchantId: row.merchantId, type: "shipping_wallet_low_balance",
          ...lowWalletContent(balance.balanceCents, current.thresholdCents),
          metadata: { href: "#delivery", environment: row.environment, balanceCents: balance.balanceCents, thresholdCents: current.thresholdCents },
        } });
        await tx.melhorEnvioWallet.update({ where: { id: row.id }, data: {
          ...balance, checkedAt: new Date(), lastErrorCode: null, lowBalance: low, alertId,
          ...(started ? { emailPending: current.emailEnabled && !!recipient, emailAttempts: 0, emailStartedAt: null, emailSentAt: null, emailRecipient: recipient } :
            !low ? { emailPending: false, emailAttempts: 0, emailStartedAt: null, emailSentAt: null, emailRecipient: null } : {}),
        } });
      });
      await this.deliverEmail(row.id, leaseToken);
    } catch (error) {
      await this.prisma.melhorEnvioWallet.updateMany({ where: { id: row.id, leaseToken }, data: {
        lastErrorCode: error instanceof ShippingWalletError ? error.code : "provider_unavailable",
      } });
    } finally {
      await this.prisma.melhorEnvioWallet.updateMany({ where: { id: row.id, leaseToken }, data: { leaseToken: null, leaseUntil: null } });
    }
  }

  private async deliverEmail(id: string, leaseToken: string) {
    const row = await this.prisma.melhorEnvioWallet.findUniqueOrThrow({ where: { id } });
    if (row.leaseToken !== leaseToken || !row.alertEnabled || !row.emailEnabled || !row.lowBalance || !row.emailPending ||
      !row.alertId || !row.emailRecipient || row.emailAttempts >= 5 || row.lastErrorCode || !row.checkedAt ||
      Date.now() - row.checkedAt.getTime() > WALLET_CHECK_INTERVAL_MS ||
      row.emailStartedAt && Date.now() - row.emailStartedAt.getTime() > 23 * 3600_000) return;
    const merchant = await this.merchant(row.merchantId);
    if (!merchant.melhorEnvioEnabled || !merchant.melhorEnvioAccessToken || merchant.users[0]?.email !== row.emailRecipient) return;
    const content = await this.prisma.merchantNotification.findFirst({ where: {
      id: `shipping-wallet-${row.alertId}`, merchantId: row.merchantId,
    }, select: { title: true, body: true } });
    if (!content?.body) return;
    const claim = await this.prisma.melhorEnvioWallet.updateMany({ where: { id, leaseToken, alertId: row.alertId, emailPending: true },
      data: { emailAttempts: { increment: 1 }, emailStartedAt: row.emailStartedAt ?? new Date() } });
    if (!claim.count) return;
    const link = this.provider.location().rechargeUrl;
    try {
      const sent = await this.email.send({ to: row.emailRecipient, subject: content.title,
        text: `${content.body}\nAdicionar créditos: ${link}`,
        html: `<p>${content.body}</p><p><a href="${link}">Adicionar créditos no Melhor Envio</a></p><p>Entre na mesma conta conectada à sua loja para fazer a recarga.</p>`,
        requireDelivery: true, idempotencyKey: `shipping-wallet:${row.alertId}`,
      });
      if ((sent.status === "sent" || sent.status === "queued") && sent.messageId?.trim()) {
        await this.prisma.melhorEnvioWallet.updateMany({ where: { id, leaseToken, alertId: row.alertId }, data: { emailPending: false, emailSentAt: new Date() } });
      }
    } catch { /* Durable pending delivery is retried with the same provider idempotency key. */ }
  }

  async monitor() {
    const { base, environment } = this.provider.location();
    const rows = await this.prisma.melhorEnvioWallet.findMany({ where: {
      environment, alertEnabled: true,
      merchant: { melhorEnvioEnabled: true, melhorEnvioAccessToken: { not: null }, melhorEnvioRefreshToken: { not: null } },
      OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: new Date(Date.now() - WALLET_CHECK_INTERVAL_MS) } }],
    }, orderBy: { lastAttemptAt: { sort: "asc", nulls: "first" } }, take: 25 });
    for (let i = 0; i < rows.length; i += 5) await Promise.all(rows.slice(i, i + 5).map(row => this.refresh(row, base)));
  }
}
