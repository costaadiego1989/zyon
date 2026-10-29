import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { BillingAdminNotice, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PRISMA_CROSS_MERCHANT_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../domain/ports/email-sender.port.js";
import { EmailProviderRejection } from "../../domain/ports/email-provider-rejection.js";

export function renderBillingAdminNotice(notice: BillingAdminNotice, merchantName: string, ownerEmail: string | null) {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const plan = ({ starter179: "Starter", growth: "Growth", scale: "Scale" } as Record<string, string>)[notice.planKey] ?? notice.planKey;
  const money = (amount: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: notice.currency }).format(amount / 100);
  const environment = process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "local";
  const production = ["production", "prod"].includes(environment.toLowerCase());
  const rows = [
    ["Empresa", merchantName], ["Responsável", ownerEmail ?? "Não identificado"], ["Plano", plan],
    ["Periodicidade", notice.billingCycle === "annual" ? "Anual" : "Mensal"],
    ["Valor pago nesta fatura", money(notice.amountPaidCents)], ["Desconto nesta fatura", money(notice.discountCents)],
    ["Pagamento confirmado", notice.occurredAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + " (Brasília)"],
    ["Ambiente", environment], ["Empresa ID", notice.merchantId], ["Assinatura Stripe", notice.subscriptionId], ["Fatura Stripe", notice.invoiceId],
  ];
  let url = "https://zyon-control.vercel.app/";
  try {
    const configured = new URL(process.env.PLATFORM_CONTROL_PUBLIC_URL ?? url);
    if (configured.protocol === "https:" && !configured.username && !configured.password) url = configured.href;
  } catch { /* Use the known platform URL, never customer-controlled content. */ }
  return {
    subject: `${production ? "" : "[TESTE] "}Zyon | Nova assinatura ${plan.replace(/[\r\n]/g, " ")} confirmada`,
    html: `<html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#17251d;max-width:640px;margin:32px auto;padding:20px"><h1 style="font-size:24px">Nova assinatura confirmada</h1><p>O Stripe confirmou o pagamento inicial de uma assinatura da Zyon.</p><table style="width:100%;border-collapse:collapse">${rows.map(([label, value]) => `<tr><th style="text-align:left;padding:10px;border-bottom:1px solid #ddd;font-weight:600">${escape(label!)}</th><td style="padding:10px;border-bottom:1px solid #ddd;overflow-wrap:anywhere">${escape(value!)}</td></tr>`).join("")}</table><p><a href="${escape(url)}">Abrir painel administrativo</a></p><p style="font-size:13px">O valor acima é o valor efetivamente pago nesta fatura, após descontos. Este aviso não representa uma nova cobrança nem uma renovação.</p></body></html>`,
  };
}

@Injectable()
export class BillingAdminNoticeJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingAdminNoticeJob.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping = false;

  constructor(
    @Inject(PRISMA_CROSS_MERCHANT_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EMAIL_SENDER_PORT) private readonly email: EmailSenderPort,
  ) {}

  onModuleInit(): void {
    if (process.env.BILLING_ADMIN_NOTIFICATION_ENABLED === "false") return;
    this.timer = setInterval(() => { void this.runOnce(); }, 5_000);
    this.timer.unref();
    void this.runOnce();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  runOnce(): Promise<void> {
    if (this.stopping || process.env.BILLING_ADMIN_NOTIFICATION_ENABLED === "false" || this.running) return this.running ?? Promise.resolve();
    this.running = this.run().catch(() => this.logger.error("billing_admin_notice_worker_failed"))
      .finally(() => { this.running = undefined; });
    return this.running;
  }

  private async run(): Promise<void> {
    const now = new Date();
    await this.prisma.billingAdminNotice.updateMany({ where: { status: "preparing", lockedUntil: { lte: now } },
      data: { status: "pending", lockedUntil: null, claimToken: null, lastErrorCode: "preparation_lease_expired" } });
    const expired = await this.prisma.billingAdminNotice.updateMany({ where: { status: "sending", lockedUntil: { lte: now } },
      data: { status: "unknown", lockedUntil: null, claimToken: null, lastErrorCode: "provider_acceptance_unknown" } });
    if (expired.count) this.logger.error("billing_admin_notice_acceptance_unknown");
    for (let index = 0; index < 20 && !this.stopping; index++) {
      const notice = await this.claim();
      if (!notice) break;
      await this.deliver(notice);
    }
  }

  private claim(): Promise<BillingAdminNotice | null> {
    return this.prisma.$transaction(async tx => {
      const candidates = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM billing_admin_notices
        WHERE status = 'pending' AND next_attempt_at <= NOW() ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!candidates[0]) return null;
      return tx.billingAdminNotice.update({ where: { id: candidates[0].id }, data: { status: "preparing", claimToken: randomUUID(),
        lockedUntil: new Date(Date.now() + 120_000), attempts: { increment: 1 } } });
    });
  }

  private async finish(notice: BillingAdminNotice, status: string, code: string | null, messageId?: string) {
    const result = await this.prisma.billingAdminNotice.updateMany({ where: { id: notice.id, claimToken: notice.claimToken, status: { in: ["preparing", "sending"] } },
      data: { status: status === "pending" && notice.attempts >= 12 ? "failed" : status, lastErrorCode: code,
        providerMessageId: messageId ?? null, lockedUntil: null, claimToken: null,
        nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(notice.attempts, 7))) } });
    if (!result.count || ["unknown", "failed"].includes(status) || (status === "pending" && notice.attempts >= 12)) {
      this.logger.error("billing_admin_notice_requires_attention");
    }
  }

  private async deliver(notice: BillingAdminNotice): Promise<void> {
    let sending = false;
    try {
      let recipient = process.env.BILLING_ADMIN_NOTIFICATION_EMAIL?.trim();
      if (!recipient) {
        // Only infer the recipient when there is exactly one enabled administrator.
        const admins = await this.prisma.platformOperator.findMany({ where: { role: "platform_admin", disabledAt: null }, select: { email: true }, take: 2 });
        if (admins.length === 1) recipient = admins[0]!.email;
      }
      if (!recipient || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) {
        await this.finish(notice, "pending", "admin_recipient_not_configured"); return;
      }
      const merchant = await this.prisma.merchant.findUnique({ where: { id: notice.merchantId },
        select: { name: true, users: { where: { disabledAt: null, role: "owner" }, select: { email: true }, orderBy: { createdAt: "asc" }, take: 1 } } });
      const content = renderBillingAdminNotice(notice, merchant?.name ?? notice.merchantId, merchant?.users[0]?.email ?? null);
      const started = await this.prisma.billingAdminNotice.updateMany({ where: { id: notice.id, status: "preparing", claimToken: notice.claimToken, lockedUntil: { gt: new Date() } },
        data: { status: "sending", lockedUntil: new Date(Date.now() + 120_000) } });
      if (!started.count) return;
      sending = true;
      const result = await this.email.send({ to: recipient, ...content, requireDelivery: true, idempotencyKey: `billing-admin:${notice.id}` });
      if (result.status === "skipped") { await this.finish(notice, "pending", "email_provider_not_configured_or_not_allowed"); return; }
      if (!result.messageId?.trim()) { await this.finish(notice, "unknown", "provider_acceptance_unknown"); return; }
      await this.finish(notice, "sent", null, result.messageId);
    } catch (error) {
      if (error instanceof EmailProviderRejection) {
        await this.finish(notice, error.retryable ? "pending" : "failed", "email_provider_rejected");
      } else await this.finish(notice, sending ? "unknown" : "pending", sending ? "provider_acceptance_unknown" : "preparation_failed");
    }
  }
}
