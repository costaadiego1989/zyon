import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../notifications/domain/ports/email-sender.port.js";

interface Notice {
  id: string;
  merchantId: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
}

const TYPE = "cart_recovery_template_status";
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

/** One automatic delivery attempt per persisted status notice, including across workers. */
@Injectable()
export class RecoveryTemplateNoticeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecoveryTemplateNoticeWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(EMAIL_SENDER_PORT) private readonly sender: EmailSenderPort,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.runOnce().catch(() => this.logger.error("Recovery template notice scan failed")); }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const notices = await (this.prisma as any).merchantNotification.findMany({
        where: { type: TYPE, metadata: { path: ["emailStatus"], equals: "pending" } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50,
      }) as Notice[];
      for (const notice of notices) {
        try { await this.deliver(notice); }
        catch { this.logger.error("Recovery template notice processing failed"); }
      }
    } finally { this.running = false; }
  }

  private async deliver(notice: Notice): Promise<void> {
    const notifications = (this.prisma as any).merchantNotification;
    const claim = await notifications.updateMany({
      where: { id: notice.id, merchantId: notice.merchantId, type: TYPE, metadata: { path: ["emailStatus"], equals: "pending" } },
      data: { metadata: { ...notice.metadata, emailStatus: "sending" } },
    });
    if (claim.count !== 1) return;

    let emailStatus: "sent" | "unavailable" | "unknown" = "unknown";
    let emailMessageId: string | undefined;
    try {
      const owner = await (this.prisma as any).merchantUser.findFirst({
        where: { merchantId: notice.merchantId, role: "owner" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { email: true },
      }) as { email: string } | null;
      if (!owner || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email)) {
        emailStatus = "unavailable";
      } else {
        const result = await this.sender.send({
          to: owner.email, subject: notice.title.replace(/[\r\n]/g, " "), requireDelivery: true,
          html: `<h1>${escapeHtml(notice.title)}</h1><p>${escapeHtml(notice.body ?? "O estado do template de recuperação foi atualizado.")}</p><p>Confira o estado na tela de recuperação de carrinho da sua conta.</p>`,
        });
        if ((result.status === "sent" || result.status === "queued") && typeof result.messageId === "string" && result.messageId.trim()) {
          emailStatus = "sent";
          emailMessageId = result.messageId;
        } else if (result.status === "skipped" && !result.messageId) emailStatus = "unavailable";
      }
    } catch { /* Acceptance may have happened. Never retry an ambiguous delivery. */ }
    await notifications.updateMany({
      where: { id: notice.id, merchantId: notice.merchantId, type: TYPE, metadata: { path: ["emailStatus"], equals: "sending" } },
      data: { metadata: { ...notice.metadata, emailStatus, ...(emailMessageId ? { emailMessageId } : {}) } },
    });
  }
}
