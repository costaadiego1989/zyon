import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { CashbackDraft, CashbackProgramView, CashbackRules } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { assertWallet, CashbackError, emptyWallet, fingerprint, type Grant, type Reservation, type Wallet } from "../domain/cashback.js";
import type { CashbackRepositoryPort, CashbackTx, QuoteRow } from "../domain/ports/cashback-repository.port.js";

export interface ProgramRow {
  merchant_id: string; status: CashbackProgramView["status"]; draft: CashbackDraft | null;
  published: CashbackRules | null; version: number; updated_at: Date;
}
export function programView(row: ProgramRow | undefined, merchantId: string): CashbackProgramView {
  return row ? { merchantId, status: row.status, draft: row.draft, published: row.published, version: row.version, updatedAt: row.updated_at.toISOString() }
    : { merchantId, status: "disabled", draft: null, published: null, version: 0, updatedAt: null };
}

@Injectable()
export class CashbackRepository implements CashbackRepositoryPort {
  constructor(@Inject(PRISMA_CLIENT) public readonly prisma: PrismaClient) {}

  async transaction<T>(merchantId: string, body: (tx: CashbackTx) => Promise<T>): Promise<T> {
    if (!merchantId || merchantId.length > 200) throw new CashbackError("cashback_merchant_invalid");
    return this.prisma.$transaction(async tx => {
      // One lock order for program, budget and wallet prevents cross-wallet budget races.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cashback:${merchantId}`}, 0))::text`;
      return body(tx);
    }, { maxWait: 10000, timeout: 20000 });
  }

  async command<T>(tx: CashbackTx, merchantId: string, key: string, input: unknown, body: () => Promise<T>): Promise<T> {
    if (!key || key.length > 400) throw new CashbackError("cashback_idempotency_key_required");
    const hash = fingerprint(input);
    const rows = await tx.$queryRaw<Array<{ fingerprint: string; result: T }>>`SELECT fingerprint,result FROM cashback_event_receipts WHERE merchant_id=${merchantId} AND command_key=${key}`;
    if (rows[0]) {
      if (rows[0].fingerprint !== hash) throw new CashbackError("cashback_idempotency_input_mismatch", 409);
      return rows[0].result;
    }
    const result = await body();
    await tx.$executeRaw`INSERT INTO cashback_event_receipts(merchant_id,command_key,fingerprint,result) VALUES(${merchantId},${key},${hash},${JSON.stringify(result ?? null)}::jsonb)`;
    return result;
  }

  async program(tx: CashbackTx, merchantId: string): Promise<CashbackProgramView> {
    const rows = await tx.$queryRaw<ProgramRow[]>`SELECT * FROM cashback_programs WHERE merchant_id=${merchantId}`;
    return programView(rows[0], merchantId);
  }
  async wallet(tx: CashbackTx, merchantId: string, buyerId: string): Promise<Wallet> {
    const [lots, reservations] = await Promise.all([
      tx.$queryRaw<Array<{ data: Grant }>>`SELECT data FROM cashback_grants WHERE merchant_id=${merchantId} AND buyer_id=${buyerId} ORDER BY created_at,id`,
      tx.$queryRaw<Array<{ data: Reservation }>>`SELECT data FROM cashback_reservations WHERE merchant_id=${merchantId} AND buyer_id=${buyerId} ORDER BY created_at,id`,
    ]);
    const result = emptyWallet(merchantId, buyerId); result.grants = lots.map(x => x.data); result.reservations = reservations.map(x => x.data);
    assertWallet(result); return result;
  }
  async saveWallet(tx: CashbackTx, w: Wallet): Promise<void> {
    assertWallet(w);
    const { walletBalance } = await import("../domain/cashback.js");
    const balance = walletBalance(w);
    await tx.$executeRaw`INSERT INTO cashback_wallets(merchant_id,buyer_id,balance,version) VALUES(${w.merchantId},${w.buyerId},${JSON.stringify(balance)}::jsonb,1)
      ON CONFLICT(merchant_id,buyer_id) DO UPDATE SET balance=EXCLUDED.balance,version=cashback_wallets.version+1,updated_at=now()`;
    for (const g of w.grants) await tx.$executeRaw`INSERT INTO cashback_grants(id,merchant_id,buyer_id,order_id,data,created_at) VALUES(${g.id},${w.merchantId},${w.buyerId},${g.orderId},${JSON.stringify(g)}::jsonb,${new Date(g.createdAt)})
      ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data WHERE cashback_grants.merchant_id=EXCLUDED.merchant_id AND cashback_grants.buyer_id=EXCLUDED.buyer_id`;
    for (const r of w.reservations) await tx.$executeRaw`INSERT INTO cashback_reservations(id,merchant_id,buyer_id,session_id,state,data,created_at) VALUES(${r.id},${w.merchantId},${w.buyerId},${r.sessionId},${r.state},${JSON.stringify(r)}::jsonb,${new Date(r.createdAt)})
      ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,data=EXCLUDED.data WHERE cashback_reservations.merchant_id=EXCLUDED.merchant_id AND cashback_reservations.buyer_id=EXCLUDED.buyer_id`;
    for (const e of w.entries) await tx.$executeRaw`INSERT INTO cashback_ledger_entries(id,merchant_id,buyer_id,type,amount_cents,order_id,session_id,reason,actor_id,occurred_at)
      VALUES(${e.id},${w.merchantId},${w.buyerId},${e.type},${e.amountCents},${e.orderId},${e.sessionId},${e.reason},${e.actorId},${new Date(e.occurredAt)})`;
    w.entries.length = 0;
  }
  async quote(tx: CashbackTx, merchantId: string, sessionId: string, paymentKey: string): Promise<QuoteRow | undefined> {
    const rows = await tx.$queryRaw<QuoteRow[]>`SELECT * FROM cashback_earning_quotes WHERE merchant_id=${merchantId} AND session_id=${sessionId} AND payment_key=${paymentKey}`;
    return rows[0];
  }
  async updateQuote(tx: CashbackTx, q: QuoteRow): Promise<void> {
    await tx.$executeRaw`UPDATE cashback_earning_quotes SET state=${q.state},payment_intent_id=${q.payment_intent_id},data=${JSON.stringify(q.data)}::jsonb,updated_at=now() WHERE id=${q.id} AND merchant_id=${q.merchant_id}`;
  }
}
