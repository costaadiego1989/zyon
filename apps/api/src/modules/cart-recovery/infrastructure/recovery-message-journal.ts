import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { decryptPii, encryptPii } from "../../../shared/crypto/pii-cipher.service.js";

export interface RecoveryMessageSnapshot {
  name: string | null;
  email: string | null;
  phone: string | null;
  recipient: string;
  body: string;
  subject: string | null;
  template: string | null;
}
export interface RecoveryMessageRow {
  id: string; correlation_id: string; channel: string; snapshot: string;
  status: string; provider_message_id: string | null; reason: string | null;
  sent_at: Date | null; delivered_at: Date | null; read_at: Date | null;
  failed_at: Date | null; created_at: Date;
}

/** Independent of attempt writes: a fast provider receipt cannot be overwritten by the sender. */
export class RecoveryMessageJournal {
  constructor(private readonly db: PrismaClient) {}

  async prepare(merchantId: string, correlationId: string, channel: string, snapshot: RecoveryMessageSnapshot, configId?: string): Promise<string> {
    const id = randomUUID();
    const encrypted = encryptPii(JSON.stringify(snapshot));
    await this.db.$executeRaw(Prisma.sql`INSERT INTO recovery_messages
      (id, merchant_id, correlation_id, channel, config_id, snapshot)
      VALUES (${id}, ${merchantId}, ${correlationId}, ${channel}, ${configId ?? null}, ${encrypted})`);
    return id;
  }

  async complete(id: string, result: { status: string; messageId?: string; reason?: string }) {
    const status = ["sent", "queued"].includes(result.status) && result.messageId?.trim() ? "accepted"
      : result.status === "skipped" ? "skipped" : result.status === "failed" ? "failed" : "unknown";
    await this.db.$executeRaw(Prisma.sql`UPDATE recovery_messages SET
      status = CASE WHEN status IN ('delivered', 'read', 'failed') THEN status ELSE ${status} END,
      provider_message_id = COALESCE(provider_message_id, ${result.messageId || null}),
      reason = COALESCE(reason, ${result.reason ?? null}),
      sent_at = CASE WHEN ${status} = 'accepted' THEN COALESCE(sent_at, CURRENT_TIMESTAMP) ELSE sent_at END,
      failed_at = CASE WHEN ${status} = 'failed' THEN COALESCE(failed_at, CURRENT_TIMESTAMP) ELSE failed_at END
      WHERE id = ${id} AND (provider_message_id IS NULL OR provider_message_id = ${result.messageId || null})`);
  }

  async receipt(input: { merchantId: string; configId: string; messageId: string; status: string; correlationId?: string; timestamp?: string; errorCode?: number }) {
    if (!["sent", "delivered", "read", "failed"].includes(input.status) || !input.messageId || input.messageId.length > 1024) return;
    const seconds = input.timestamp && /^\d{1,12}$/.test(input.timestamp) ? Number(input.timestamp) : NaN;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > Date.now() + 300_000) return;
    const at = new Date(seconds * 1000);
    const status = input.status === "sent" ? "accepted" : input.status;
    const reason = input.status === "failed" && Number.isSafeInteger(input.errorCode) ? `meta_error_${input.errorCode}` : null;
    // Callback routing has already authenticated the signature and phone-number account.
    // Match both merchant and the exact sending config, even when correlation is supplied.
    await this.db.$executeRaw(Prisma.sql`UPDATE recovery_messages SET
      status = CASE WHEN status = 'read' THEN status
        WHEN status = 'delivered' AND ${status} != 'read' THEN status
        WHEN status = 'failed' AND ${status} = 'accepted' THEN status ELSE ${status} END,
      provider_message_id = COALESCE(provider_message_id, ${input.messageId}),
      sent_at = CASE WHEN ${status} = 'accepted' THEN COALESCE(sent_at, ${at}) ELSE sent_at END,
      delivered_at = CASE WHEN ${status} = 'delivered' THEN COALESCE(delivered_at, ${at}) ELSE delivered_at END,
      read_at = CASE WHEN ${status} = 'read' THEN COALESCE(read_at, ${at}) ELSE read_at END,
      failed_at = CASE WHEN ${status} = 'failed' THEN COALESCE(failed_at, ${at}) ELSE failed_at END,
      reason = COALESCE(reason, ${reason})
      WHERE merchant_id = ${input.merchantId} AND config_id = ${input.configId} AND channel = 'whatsapp_template'
        AND status != 'skipped'
        AND (provider_message_id = ${input.messageId} OR
          (provider_message_id IS NULL AND status IN ('dispatching', 'unknown') AND correlation_id = ${input.correlationId ?? null}))`);
  }

  async list(merchantId: string, correlations: string[]) {
    if (!correlations.length) return [];
    const rows = await this.db.$queryRaw<RecoveryMessageRow[]>(Prisma.sql`SELECT * FROM recovery_messages
      WHERE merchant_id = ${merchantId} AND correlation_id IN (${Prisma.join(correlations)}) ORDER BY created_at ASC, id ASC`);
    return rows.map(({ snapshot, ...row }) => ({ ...row, ...JSON.parse(decryptPii(snapshot)) as RecoveryMessageSnapshot }));
  }
}
