import type { PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import type { FiscalRecipientStore } from "../domain/fiscal-recipient-update.port.js";
import { UnauthorizedException } from "@nestjs/common";

/** A partial JSON update preserves concurrent cart/personal customer changes. */
export class PrismaFiscalRecipientRepository implements FiscalRecipientStore {
  constructor(private readonly db: PrismaClient) {}
  async getSession(merchantId: string, sessionId: string): Promise<CheckoutSession | undefined> {
    const row = await this.db.checkoutSession.findFirst({ where: { merchantId, sessionId } });
    if (!row) return undefined;
    return { ...row, cart: row.cart, customer: row.customer ?? undefined, chatHistory: row.chatHistory ?? [] } as unknown as CheckoutSession;
  }
  async saveRecipient(input: Parameters<FiscalRecipientStore["saveRecipient"]>[0]): Promise<void> {
    const patch = { ...input.personal, fiscalRecipient: input.recipient, ...(input.mode ? { fiscalRecipientMode: input.mode } : {}) };
    const count = await this.db.$executeRaw`
      UPDATE checkout_sessions SET customer = COALESCE(customer, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, updated_at = NOW(), version = version + 1
      WHERE merchant_id = ${input.merchantId} AND session_id = ${input.sessionId} AND global_user_id = ${input.buyerId}
      AND (${input.expectedCustomer === undefined} OR COALESCE(customer, '{}'::jsonb) = ${JSON.stringify(input.expectedCustomer ?? {})}::jsonb)`;
    if (count !== 1) throw new UnauthorizedException("fiscal_checkout_ownership_required");
  }
}
