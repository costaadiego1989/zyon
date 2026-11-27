import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { decryptPii, isPiiEncrypted } from "../../../shared/crypto/pii-cipher.service.js";
import { RecoveryMessageJournal } from "../infrastructure/recovery-message-journal.js";

const statuses = new Set(["pending", "sent", "recovered", "failed", "expired", "unknown"]);
const contact = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  if (/@buyer\.aacp$/i.test(value)) return null;
  return isPiiEncrypted(value) ? decryptPii(value) : value;
};

@Injectable()
export class RecoveryAttemptDetailsService {
  constructor(@Inject(PRISMA_CLIENT) private readonly db: PrismaClient) {}

  async list(merchantId: string, query: { limit?: number | string; offset?: number | string; status?: string; channel?: string } = {}) {
    const limit = Number.isFinite(Number(query.limit)) ? Math.min(100, Math.max(1, Math.floor(Number(query.limit)))) : 10;
    const offset = Number.isFinite(Number(query.offset)) ? Math.max(0, Math.floor(Number(query.offset))) : 0;
    const where = { merchantId, ...(statuses.has(query.status!) ? { status: query.status } : {}),
      ...(["email", "whatsapp_template"].includes(query.channel!) ? { channel: query.channel } : {}) };
    const [rows, total] = await this.db.$transaction([
      this.db.recoveryAttempt.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset }),
      this.db.recoveryAttempt.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const userIds = [...new Set(rows.map(row => row.globalUserId))];
    const [accounts, sessions] = await Promise.all([
      this.db.buyerAccount.findMany({ where: { globalUserId: { in: userIds } }, select: { globalUserId: true, displayName: true, email: true, phone: true } }),
      this.db.checkoutSession.findMany({ where: { merchantId, sessionId: { in: rows.map(row => row.sessionId) } }, select: { sessionId: true, globalUserId: true, customer: true } }),
    ]);
    const messages = await new RecoveryMessageJournal(this.db).list(merchantId, rows.map(row => row.id));
    return { total, data: rows.map(row => {
      const account = accounts.find(a => a.globalUserId === row.globalUserId);
      const customer = sessions.find(s => s.sessionId === row.sessionId && s.globalUserId === row.globalUserId)?.customer as { name?: string; email?: string; phone?: string } | null;
      const sent = messages.filter(m => m.correlation_id === row.id);
      const message = sent.find(m => m.channel === row.channel) ?? sent.at(-1);
      return { id: row.id, session_id: row.sessionId, strategy: (row.strategyJson as { type?: string })?.type ?? "",
        status: row.status, channel: row.channel, created_at: row.createdAt, sent_at: row.sentAt,
        customer: message ? { name: message.name, email: message.email, phone: message.phone }
          : { name: contact(account?.displayName) ?? contact(customer?.name), email: contact(account?.email) ?? contact(customer?.email), phone: contact(account?.phone) ?? contact(customer?.phone) },
        contact_source: message ? "send_snapshot" : "current_profile", recipient: message?.recipient ?? null,
        delivery_status: message?.status ?? null, delivered_at: message?.delivered_at ?? null, read_at: message?.read_at ?? null };
    }) };
  }

  async detail(merchantId: string, id: string) {
    const row = await this.db.recoveryAttempt.findFirst({ where: { id, merchantId }, include: { followUps: { where: { merchantId }, orderBy: { step: "asc" } } } });
    if (!row) throw new NotFoundException("recovery_attempt_not_found");
    const metadata = row.deliveryMetadata as { providerMessageId?: string; reason?: string; fallbackReason?: string } | null;
    const messages = await new RecoveryMessageJournal(this.db).list(merchantId, [id, ...row.followUps.map(f => f.id)]);
    return { id, session_id: row.sessionId, status: row.status, channel: row.channel,
      strategy: (row.strategyJson as { type?: string })?.type ?? "", created_at: row.createdAt,
      sent_at: row.sentAt, recovered_at: row.recoveredAt, recovered_order_id: row.recoveredOrderId,
      abandonment_reason: row.abandonmentReason, last_activity_at: row.lastBuyerActivityAt,
      reason: metadata?.reason ?? null, fallback_reason: metadata?.fallbackReason ?? null,
      provider_message_id: metadata?.providerMessageId ?? null,
      messages,
      follow_ups: row.followUps.map(f => ({ id: f.id, step: f.step, due_at: f.dueAt, sent_at: f.sentAt,
        status: f.status, channel: f.channel, reason: f.reason, fallback_reason: f.fallbackReason, provider_message_id: f.providerMessageId })),
    };
  }
}
