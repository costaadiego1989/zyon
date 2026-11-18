import type { PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import { ConflictException } from "@nestjs/common";
import type { FiscalRecipientCollectionState, FiscalRecipientCollectionStore } from "../domain/fiscal-recipient-collection.port.js";

/** Buyer collection uses session optimistic concurrency and partial customer JSON. */
export class PrismaFiscalRecipientCollectionRepository implements FiscalRecipientCollectionStore {
  constructor(private readonly db: PrismaClient) {}
  async read(merchantId: string, sessionId: string) {
    const row = await this.db.checkoutSession.findFirst({ where: { merchantId, sessionId } });
    if (!row) return null;
    const customer = row.customer as Record<string, unknown> | null;
    const candidate = customer?.fiscalCollection as FiscalRecipientCollectionState | undefined;
    const state = candidate?.version === 1 && candidate.draft && candidate.seen ? structuredClone(candidate) : null;
    return { session: row as unknown as CheckoutSession, version: row.version, state };
  }
  async save(input: Parameters<FiscalRecipientCollectionStore["save"]>[0]): Promise<void> {
    const patch = { ...input.personal, fiscalCollection: input.state, ...(input.mode ? { fiscalRecipientMode: input.mode } : {}), ...(input.recipient ? { fiscalRecipient: input.recipient } : {}) };
    const count = await this.db.$executeRaw`UPDATE checkout_sessions SET customer = COALESCE(customer, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
      updated_at = NOW(), version = version + 1 WHERE merchant_id = ${input.merchantId} AND session_id = ${input.sessionId}
      AND global_user_id = ${input.buyerId} AND version = ${input.version}`;
    if (count !== 1) throw new ConflictException("fiscal_collection_changed_retry");
  }
}
