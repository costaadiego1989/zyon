import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import {
  INBOX_LEASE_MS, INBOX_MAX_ATTEMPTS,
  type WhatsAppInboxClaim, type WhatsAppInboxEvent, type WhatsAppWebhookInbox,
} from "../../domain/ports/whatsapp-webhook-inbox.port.js";

interface ClaimRow {
  id: string; dedup_key: string; event_id: string; kind: "message" | "status";
  merchant_id: string; config_id: string; device_id: string; stream_key: string;
  payload: WhatsAppInboxEvent["payload"]; payload_hash: string; lease_token: string; attempts: number;
}

@Injectable()
export class PrismaWhatsAppWebhookInbox implements WhatsAppWebhookInbox {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async accept(events: WhatsAppInboxEvent[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Sort to give concurrent overlapping status batches the same lock order.
      for (const event of [...events].sort((a, b) => a.dedupKey.localeCompare(b.dedupKey))) {
        const inserted = await tx.$executeRaw(Prisma.sql`
          INSERT INTO "whatsapp_webhook_inbox"
            ("id", "dedup_key", "event_id", "kind", "merchant_id", "config_id", "device_id",
             "stream_key", "payload", "payload_hash")
          VALUES (${randomUUID()}, ${event.dedupKey}, ${event.eventId}, ${event.kind},
            ${event.merchantId}, ${event.configId}, ${event.deviceId}, ${event.streamKey},
            ${JSON.stringify(event.payload)}::jsonb, ${event.payloadHash})
          ON CONFLICT ("dedup_key") DO NOTHING
        `);
        if (inserted === 0) {
          const rows = await tx.$queryRaw<Array<{ payload_hash: string }>>(Prisma.sql`
            SELECT "payload_hash" FROM "whatsapp_webhook_inbox" WHERE "dedup_key" = ${event.dedupKey}
          `);
          if (rows[0]?.payload_hash !== event.payloadHash) {
            throw new ConflictException("webhook_event_payload_conflict");
          }
        }
      }
    });
  }

  async claimNext(): Promise<WhatsAppInboxClaim | null> {
    return this.prisma.$transaction(async (tx) => {
      // A crash on the final attempt must also reach the durable dead-letter state.
      await tx.$executeRaw(Prisma.sql`
        UPDATE "whatsapp_webhook_inbox" SET "status" = 'dead', "lease_token" = NULL,
          "lease_expires_at" = NULL, "last_error" = 'lease_expired_attempts_exhausted', "updated_at" = NOW()
        WHERE "status" = 'processing' AND "lease_expires_at" <= NOW() AND "attempts" >= ${INBOX_MAX_ATTEMPTS}
      `);
      const rows = await tx.$queryRaw<ClaimRow[]>(Prisma.sql`
        WITH candidate AS (
          SELECT candidate."id" FROM "whatsapp_webhook_inbox" AS candidate
          WHERE candidate."attempts" < ${INBOX_MAX_ATTEMPTS}
            AND ((candidate."status" = 'pending' AND candidate."available_at" <= NOW())
              OR (candidate."status" = 'processing' AND candidate."lease_expires_at" <= NOW()))
            AND NOT EXISTS (
              SELECT 1 FROM "whatsapp_webhook_inbox" AS earlier
              WHERE earlier."stream_key" = candidate."stream_key"
                AND earlier."status" IN ('pending', 'processing')
                AND (earlier."created_at", earlier."id") < (candidate."created_at", candidate."id")
            )
          ORDER BY candidate."created_at", candidate."id"
          LIMIT 1 FOR UPDATE OF candidate SKIP LOCKED
        )
        UPDATE "whatsapp_webhook_inbox" AS event
          SET "status" = 'processing', "lease_token" = ${randomUUID()},
            "lease_expires_at" = NOW() + ${INBOX_LEASE_MS} * INTERVAL '1 millisecond',
            "attempts" = "attempts" + 1, "updated_at" = NOW()
          FROM candidate WHERE event."id" = candidate."id" RETURNING event.*
      `);
      const row = rows[0];
      return row ? {
        id: row.id, dedupKey: row.dedup_key, eventId: row.event_id, kind: row.kind,
        merchantId: row.merchant_id, configId: row.config_id, deviceId: row.device_id,
        streamKey: row.stream_key, payload: row.payload, payloadHash: row.payload_hash,
        leaseToken: row.lease_token, attempts: row.attempts,
      } : null;
    });
  }

  async renew(claim: WhatsAppInboxClaim): Promise<boolean> {
    return (await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "whatsapp_webhook_inbox" SET
        "lease_expires_at" = NOW() + ${INBOX_LEASE_MS} * INTERVAL '1 millisecond', "updated_at" = NOW()
      WHERE "id" = ${claim.id} AND "status" = 'processing' AND "lease_token" = ${claim.leaseToken}
        AND "lease_expires_at" > NOW()
    `)) === 1;
  }

  async complete(claim: WhatsAppInboxClaim): Promise<boolean> {
    return (await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "whatsapp_webhook_inbox" SET "status" = 'processed', "processed_at" = NOW(),
        "lease_token" = NULL, "lease_expires_at" = NULL, "last_error" = NULL, "updated_at" = NOW()
      WHERE "id" = ${claim.id} AND "status" = 'processing' AND "lease_token" = ${claim.leaseToken}
        AND "lease_expires_at" > NOW()
    `)) === 1;
  }

  async fail(claim: WhatsAppInboxClaim, errorCode: string): Promise<boolean> {
    const dead = claim.attempts >= INBOX_MAX_ATTEMPTS;
    const backoffMs = Math.min(30 * 60_000, 5_000 * 2 ** (claim.attempts - 1));
    return (await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "whatsapp_webhook_inbox" SET "status" = ${dead ? "dead" : "pending"},
        "available_at" = NOW() + ${backoffMs} * INTERVAL '1 millisecond',
        "lease_token" = NULL, "lease_expires_at" = NULL, "last_error" = ${errorCode}, "updated_at" = NOW()
      WHERE "id" = ${claim.id} AND "status" = 'processing' AND "lease_token" = ${claim.leaseToken}
        AND "lease_expires_at" > NOW()
    `)) === 1;
  }
}
