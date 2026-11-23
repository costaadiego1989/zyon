import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { PrismaClient, RecoveryAttempt, RecoveryFollowUp } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { CampaignContactConsentService } from "../../../campaign-consent/campaign-contact-consent.service.js";
import { SendWhatsAppMessageUseCase } from "../../../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";
import { normalizeRecoveryRecipient } from "../../../whatsapp-templates/domain/services/recovery-whatsapp-policy.js";
import { GenerateRecoveryLinkUseCase } from "../../application/use-cases/generate-recovery-link.use-case.js";
import { STRATEGY_PREFERENCES_REPOSITORY, type StrategyPreferencesRepositoryPort } from "../../domain/ports/strategy-preferences-repository.port.js";
import { RecoveryScannerJob } from "./recovery-scanner.job.js";

type DueFollowUp = RecoveryFollowUp & { attempt: RecoveryAttempt };

/** A claim is a durable dispatch boundary; crashes never replay a customer contact. */
@Injectable()
export class RecoveryFollowUpJob implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private initial?: ReturnType<typeof setTimeout>;
  private running = false;
  private readonly logger = new Logger(RecoveryFollowUpJob.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyers: BuyerAccountRepository,
    private readonly consent: CampaignContactConsentService,
    private readonly sender: SendWhatsAppMessageUseCase,
    private readonly links: GenerateRecoveryLinkUseCase,
    private readonly eligibility: RecoveryScannerJob,
    @Inject(STRATEGY_PREFERENCES_REPOSITORY) private readonly preferences: StrategyPreferencesRepositoryPort,
  ) {}

  onModuleInit() {
    this.initial = setTimeout(() => void this.runOnce(), 5_000);
    this.timer = setInterval(() => void this.runOnce(), 60_000);
    this.logger.log("recovery-follow-up: scheduled at 24h and 72h, maximum three contacts including the first");
  }

  onModuleDestroy() {
    if (this.initial) clearTimeout(this.initial);
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.prisma.recoveryFollowUp.findMany({
        where: { status: "pending", dueAt: { lte: now } }, include: { attempt: true },
        orderBy: [{ dueAt: "asc" }, { step: "asc" }, { id: "asc" }], take: 50,
      });
      for (const row of due) {
        try { await this.process(row, now); }
        catch { this.logger.error("recovery-follow-up: processing failed; durable dispatch state preserved", { followUpId: row.id }); }
      }
    } catch { this.logger.error("recovery-follow-up: due query failed"); }
    finally { this.running = false; }
  }

  private async process(row: DueFollowUp, now: Date) {
    if (row.expiresAt <= now) {
      await this.prisma.recoveryFollowUp.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "cancelled", reason: "contact_window_expired" } });
      return;
    }
    // Hold later stages when an earlier physical send may have been accepted.
    const unresolved = await this.prisma.recoveryFollowUp.findFirst({ where: {
      attemptId: row.attemptId, id: { not: row.id }, status: { in: ["dispatching", "unknown"] },
    }, select: { id: true } });
    if (unresolved) { await this.cancelPending(row, "provider_acceptance_unknown"); return; }
    const claimed = await this.prisma.recoveryFollowUp.updateMany({ where: {
      id: row.id, merchantId: row.merchantId, attemptId: row.attemptId, status: "pending", dueAt: { lte: now }, expiresAt: { gt: now },
    }, data: { status: "dispatching" } });
    if (claimed.count !== 1) return;

    let context;
    let link: string;
    try {
      context = await this.authorizedContext(row);
      if (!context) { await this.cancelCampaign(row, "recovery_no_longer_eligible"); return; }
      // A new link is generated for every step; a three-day-old token is never reused.
      link = await this.links.execute({ merchantId: row.merchantId, sessionId: row.sessionId });
    } catch {
      await this.prisma.recoveryFollowUp.updateMany({ where: { id: row.id, status: "dispatching" }, data: { status: "failed", reason: "pre_dispatch_validation_unavailable" } });
      return;
    }

    let result;
    try {
      result = await this.sender.execute({
        merchantId: row.merchantId, correlationId: row.id, type: "cart_recovery",
        toPhone: context.phone, fallbackEmail: context.email,
        variables: { buyerName: context.name, storeName: context.storeName, link },
        emailSubject: `${context.storeName} | Continue de onde parou`,
        freeformText: `Olá, ${context.name}! Seu carrinho na ${context.storeName} está te esperando.\nRevise seus itens e continue quando quiser:\n${link}`,
        assertDispatchAuthorized: async (channel) => {
          const current = await this.prisma.recoveryFollowUp.findUnique({ where: { id: row.id }, select: { status: true } });
          const latest = await this.authorizedContext(row);
          if (current?.status !== "dispatching" || !latest || channel === "whatsapp" && !latest.phone
            || channel === "email" && !latest.email) throw new Error("recovery_authority_changed");
        },
      });
    } catch {
      result = { channel: "none" as const, status: "uncertain" as const, reason: "provider_acceptance_unknown" };
    }
    const accepted = result.status === "sent" && !!result.messageId?.trim() && ["email", "whatsapp_template"].includes(result.channel);
    const uncertain = result.status === "uncertain" || result.status === "sent" && !accepted;
    await this.prisma.recoveryFollowUp.updateMany({ where: { id: row.id, status: "dispatching" }, data: {
      status: accepted ? "sent" : uncertain ? "unknown" : result.status === "failed" ? "failed" : "cancelled",
      channel: result.channel, providerMessageId: result.messageId || null,
      reason: result.reason ?? null, fallbackReason: result.fallbackReason ?? null, sentAt: accepted ? now : null,
    } });
    if (uncertain || result.reason === "notification_authority_changed") await this.cancelPending(row, uncertain ? "provider_acceptance_unknown" : "recovery_no_longer_eligible");
  }

  private async authorizedContext(row: DueFollowUp) {
    const attempt = await this.prisma.recoveryAttempt.findUnique({ where: { id: row.attemptId } });
    if (!attempt || attempt.status !== "sent" || attempt.merchantId !== row.merchantId || attempt.sessionId !== row.sessionId
      || !attempt.lastBuyerActivityAt || !attempt.sentAt || row.step < 1 || row.step > 2) return null;
    const session = await this.sessions.getSession(row.merchantId, row.sessionId);
    if (!session || session.globalUserId !== attempt.globalUserId
      || new Date(session.updatedAt).getTime() !== attempt.lastBuyerActivityAt.getTime()
      || !await this.eligibility.isStillEligible(session)) return null;
    const strategy = await this.preferences.getConfig(row.merchantId);
    if (!strategy || strategy.active_strategy !== (attempt.strategyJson as { type?: unknown })?.type) return null;
    const account = await this.buyers.findByGlobalUserId(attempt.globalUserId);
    if (!account || account.globalUserId !== attempt.globalUserId) return null;
    const normalized = account.phone ? normalizeRecoveryRecipient(account.phone)?.slice(1) : undefined;
    if (normalized) {
      const phoneVariants = [...new Set([normalized, normalized.startsWith("55") ? normalized.slice(2) : normalized])];
      const resumed = await this.prisma.whatsAppSession.findFirst({ where: {
        merchantId: row.merchantId, buyerPhone: { in: phoneVariants }, lastActivityAt: { gt: attempt.createdAt },
      }, select: { id: true } });
      if (resumed) return null;
    }
    const whatsappAllowed = !!account.phone && await this.consent.canContact({ merchantId: row.merchantId, globalUserId: attempt.globalUserId, channel: "whatsapp" });
    const emailAllowed = !!account.email && await this.consent.canContact({ merchantId: row.merchantId, globalUserId: attempt.globalUserId, channel: "email" });
    if (!whatsappAllowed && !emailAllowed) return null;
    const merchant = await this.prisma.merchant.findUnique({ where: { id: row.merchantId }, select: { name: true } });
    if (!merchant) return null;
    return { phone: whatsappAllowed ? account.phone! : undefined, email: emailAllowed ? account.email : undefined,
      name: account.displayName || "Cliente", storeName: merchant.name };
  }

  private async cancelPending(row: DueFollowUp, reason: string) {
    await this.prisma.recoveryFollowUp.updateMany({ where: { attemptId: row.attemptId, merchantId: row.merchantId, status: "pending" }, data: { status: "cancelled", reason } });
  }

  private async cancelCampaign(row: DueFollowUp, reason: string) {
    await this.prisma.recoveryFollowUp.updateMany({ where: { attemptId: row.attemptId, merchantId: row.merchantId, status: { in: ["pending", "dispatching"] } }, data: { status: "cancelled", reason } });
  }
}
