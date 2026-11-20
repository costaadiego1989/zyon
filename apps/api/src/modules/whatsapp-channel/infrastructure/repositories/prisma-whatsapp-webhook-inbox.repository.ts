import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { mergeWhatsAppTurnResponse } from "../../domain/services/whatsapp-turn-response.js";
import type { MetaUiView, StoreUiAction } from "../../domain/ui/meta-ui.types.js";
import {
  INBOX_LEASE_MS, INBOX_MAX_ATTEMPTS,
  type WhatsAppInboxClaim, type WhatsAppInboxEvent, type WhatsAppWebhookInbox,
} from "../../domain/ports/whatsapp-webhook-inbox.port.js";

interface ClaimRow {
  id: string; dedup_key: string; event_id: string; kind: "message" | "status";
  merchant_id: string; config_id: string; device_id: string; stream_key: string;
  payload: WhatsAppInboxEvent["payload"]; payload_hash: string; lease_token: string; attempts: number;
  response_state?: Record<string, unknown>;
}

/** Lock first, then read the wall clock: NOW() would retain the transaction's
 * pre-wait time and could authorize a lease which expired behind the lock. */
export async function loadWhatsAppInboxTurnWithin(tx: Prisma.TransactionClient, claim: WhatsAppInboxClaim) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM whatsapp_webhook_inbox WHERE id=${claim.id} AND merchant_id=${claim.merchantId}
      AND config_id=${claim.configId} AND device_id=${claim.deviceId} FOR UPDATE
  `);
  if (!locked.length) return null;
  const row = await tx.whatsAppWebhookInbox.findFirst({ where: { id: claim.id, merchantId: claim.merchantId,
    configId: claim.configId, deviceId: claim.deviceId, kind: "message", status: "processing", leaseToken: claim.leaseToken } });
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS now`);
  return row?.leaseExpiresAt && row.leaseExpiresAt > clock.now && row.streamKey === claim.streamKey ? row : null;
}

/** Canonical merge in a supplied writer transaction. Used by ordinary saves
 * and atomic session/effect receipts; it never opens an independent writer. */
export async function saveWhatsAppResponseWithin(tx: Prisma.TransactionClient, claim: WhatsAppInboxClaim,
  response: Record<string, unknown>): Promise<boolean> {
  const row = await loadWhatsAppInboxTurnWithin(tx, claim);
  if (!row) return false;
  const previous = row.responseState && typeof row.responseState === "object" && !Array.isArray(row.responseState) ? row.responseState : {};
  const merged = mergeWhatsAppTurnResponse(previous, response);
  return (await tx.$executeRaw(Prisma.sql`
    UPDATE whatsapp_webhook_inbox SET response_state=${JSON.stringify(merged)}::jsonb, updated_at=clock_timestamp()
    WHERE id=${claim.id} AND merchant_id=${claim.merchantId} AND config_id=${claim.configId}
      AND status='processing' AND lease_token=${claim.leaseToken} AND lease_expires_at>clock_timestamp()
  `)) === 1;
}

/** Twilio supplies no timestamp in this webhook: its parser stamps ingestion
 * locally. Preserve the original payload/hash (including legacy rows), while
 * comparing all provider data canonically across JSONB key ordering. */
export function isEquivalentTwilioReplay(previous: unknown, candidate: unknown): boolean {
  const message = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).provider === "TWILIO"
    && ["merchantId", "deviceId", "fromNumber", "body", "messageType"].every(key => typeof (value as Record<string, unknown>)[key] === "string")
    && Number.isSafeInteger((value as Record<string, unknown>).timestamp) && Number((value as Record<string, unknown>).timestamp) >= 0;
  if (!message(previous) || !message(candidate)) return false;
  const { timestamp: _previousIngest, ...original } = previous;
  const { timestamp: _candidateIngest, ...replayed } = candidate;
  return canonicalJson(original) === canonicalJson(replayed);
}

/** A provider retry may encounter a row accepted before account evidence was
 * stored. Accept only the original body/hash; never upgrade that old row into
 * an authenticated recipient window. New account-bearing rows stay strict. */
export function isEquivalentLegacyAuthenticatedReplay(previous: unknown, previousHash: string, candidate: unknown): boolean {
  const message = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
    && ["META_CLOUD", "TWILIO"].includes(String((value as Record<string, unknown>).provider))
    && ["merchantId", "deviceId", "fromNumber", "body", "messageType"].every(key => typeof (value as Record<string, unknown>)[key] === "string")
    && Number.isSafeInteger((value as Record<string, unknown>).timestamp) && Number((value as Record<string, unknown>).timestamp) >= 0;
  if (!message(previous) || !message(candidate) || Object.hasOwn(previous, "authenticatedAccount")) return false;
  const { authenticatedAccount, ...replayed } = candidate;
  if (!authenticatedAccount || typeof authenticatedAccount !== "object" || Array.isArray(authenticatedAccount)) return false;
  const account = authenticatedAccount as Record<string, unknown>;
  if (account.provider !== candidate.provider || typeof account.accountId !== "string"
    || (account.provider === "META_CLOUD" ? !/^\d{1,80}$/.test(account.accountId) || Object.keys(account).length !== 2
      : !/^AC[a-fA-F0-9]{32}$/.test(account.accountId) || typeof account.sender !== "string" || !/^\+[1-9]\d{7,14}$/.test(account.sender) || Object.keys(account).length !== 3)) return false;
  const equivalent = candidate.provider === "TWILIO" ? isEquivalentTwilioReplay(previous, replayed) : canonicalJson(previous) === canonicalJson(replayed);
  // Rebuild only the old local ingestion timestamp in the original producer's
  // property order; JSONB key ordering must not manufacture a new legacy hash.
  const original = candidate.provider === "TWILIO" ? { ...replayed, timestamp: previous.timestamp } : replayed;
  return equivalent && createHash("sha256").update(JSON.stringify(original)).digest("hex") === previousHash;
}

@Injectable()
export class PrismaWhatsAppWebhookInbox implements WhatsAppWebhookInbox {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findPriorSelection(claim: WhatsAppInboxClaim, sessionId: string, selectionId: string) {
    if (!/^zyon:[a-f0-9]{32}$/.test(selectionId)) return null;
    const rows = await this.prisma.$queryRaw<Array<{ response_state: any }>>(Prisma.sql`
      SELECT response_state FROM whatsapp_webhook_inbox
      WHERE merchant_id = ${claim.merchantId} AND config_id = ${claim.configId}
        AND device_id = ${claim.deviceId} AND stream_key = ${claim.streamKey}
        AND kind = 'message' AND id <> ${claim.id} AND created_at >= NOW() - INTERVAL '24 hours'
        AND response_state->>'sessionId' = ${sessionId}
        AND response_state->>'phase' IN ('prepared', 'dispatching', 'complete')
        AND response_state->'state'->'selections' ? ${selectionId}
      ORDER BY created_at DESC, id DESC LIMIT 1
    `);
    const saved = rows[0]?.response_state;
    const action = saved?.state?.selections?.[selectionId] as StoreUiAction | undefined;
    const selectionSent = Array.isArray(saved?.presentation?.messages) && saved.presentation.messages.some((message: any, index: number) => {
      if (!Array.isArray(saved.sent) || !saved.sent.some((sent: any) => sent.index === index && typeof sent.messageId === "string" && sent.messageId.trim())) return false;
      const interactive = message?.type === "interactive" ? message.interactive : undefined;
      return interactive?.type === "button" && Array.isArray(interactive.action?.buttons) && interactive.action.buttons.some((button: any) => button.reply?.id === selectionId)
        || interactive?.type === "list" && Array.isArray(interactive.action?.sections) && interactive.action.sections.some((section: any) => Array.isArray(section.rows) && section.rows.some((row: any) => row.id === selectionId));
    });
    return action ? { action, view: saved.state.view as MetaUiView | undefined,
      previousView: saved.state.previousViews?.at(-1) as MetaUiView | undefined, page: saved.state.page as number | undefined,
      checkoutSessionId: saved.state.checkoutSessionId as string | undefined, conversationId: saved.state.conversationId as string | undefined, selectionSent } : null;
  }

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
          const rows = await tx.$queryRaw<Array<{ payload_hash: string; payload: unknown }>>(Prisma.sql`
            SELECT "payload_hash", "payload" FROM "whatsapp_webhook_inbox" WHERE "dedup_key" = ${event.dedupKey}
          `);
          if (rows[0]?.payload_hash !== event.payloadHash
            && !(event.kind === "message" && (isEquivalentTwilioReplay(rows[0]?.payload, event.payload)
              || isEquivalentLegacyAuthenticatedReplay(rows[0]?.payload, rows[0]?.payload_hash ?? "", event.payload)))) {
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
                AND earlier."status" IN ('pending', 'processing', 'blocked')
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
        responseState: row.response_state ?? undefined,
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

  async saveResponse(claim: WhatsAppInboxClaim, response: Record<string, unknown>): Promise<boolean> {
    return this.prisma.$transaction(tx => saveWhatsAppResponseWithin(tx, claim, response));
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
    const dead = claim.attempts >= INBOX_MAX_ATTEMPTS || ["whatsapp_turn_result_unknown", "whatsapp_send_result_unknown", "whatsapp_service_window_expired"].includes(errorCode);
    const blocked = errorCode === "whatsapp_delivery_requires_reconciliation";
    const backoffMs = Math.min(30 * 60_000, 5_000 * 2 ** (claim.attempts - 1));
    return (await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "whatsapp_webhook_inbox" SET "status" = CASE
          WHEN ${errorCode === "whatsapp_send_result_unknown"} AND "response_state"->>'phase' = 'prepared'
            AND "response_state" ? 'receipts' THEN 'pending'
          ELSE ${blocked ? "blocked" : dead ? "dead" : "pending"} END,
        "available_at" = NOW() + ${backoffMs} * INTERVAL '1 millisecond',
        "lease_token" = NULL, "lease_expires_at" = NULL, "last_error" = ${errorCode}, "updated_at" = NOW()
      WHERE "id" = ${claim.id} AND "status" = 'processing' AND "lease_token" = ${claim.leaseToken}
        AND "lease_expires_at" > NOW()
    `)) === 1;
  }
}
