import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CashbackCustomer, CashbackMetrics, CashbackPage, CashbackTransaction } from "@zyon/shared-types";
import { CashbackError } from "../domain/cashback.js";
import { CASHBACK_REPOSITORY, type CashbackRepositoryPort } from "../domain/ports/cashback-repository.port.js";
import { CashbackService } from "./cashback.service.js";

export interface CashbackListQuery { q?: string; filter?: string; buyerId?: string; type?: string; from?: string; to?: string; page?: string | number; pageSize?: string | number; }
const transactionTypes = new Set(["grant", "release", "reserve", "unreserve", "redeem", "expire", "reverse", "restore", "adjustment", "loss"]);
function pagination(q: CashbackListQuery, exportLimit?: number) {
  const page = Number(q.page ?? 1); const pageSize = exportLimit ?? Number(q.pageSize ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > (exportLimit ?? 100)) throw new CashbackError("cashback_pagination_invalid");
  return { page, pageSize, offset: exportLimit ? 0 : (page - 1) * pageSize };
}
function date(value: string | undefined, fallback: Date): Date {
  if (value === undefined || value === "") return fallback;
  // A calendar date denotes midnight UTC; the UI sends ISO boundaries explicitly.
  const d = new Date(value); if (!Number.isFinite(d.getTime())) throw new CashbackError("cashback_date_invalid"); return d;
}
function range(q: CashbackListQuery) {
  const to = date(q.to, new Date()); const from = date(q.from, new Date(to.getTime() - 30 * 86400000));
  if (from > to || to.getTime() - from.getTime() > 366 * 86400000) throw new CashbackError("cashback_period_invalid");
  return { from, to };
}
function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

@Injectable()
export class CashbackQueriesService {
  constructor(@Inject(CASHBACK_REPOSITORY) private readonly repository: CashbackRepositoryPort, private readonly service: CashbackService) {}

  async customers(merchantId: string, q: CashbackListQuery, exportLimit?: number): Promise<CashbackPage<CashbackCustomer>> {
    const p = pagination(q, exportLimit); const search = q.q?.trim() ?? ""; const filter = q.filter ?? "all";
    if (search.length > 200 || !["all", "has_balance", "never_used", "expiring", "used"].includes(filter)) throw new CashbackError("cashback_customer_filter_invalid");
    await this.service.reconcile(merchantId);
    const where = Prisma.sql`w.merchant_id=${merchantId}
      AND NOT EXISTS(SELECT 1 FROM cashback_buyer_aliases ba WHERE ba.merchant_id=w.merchant_id AND ba.alias_buyer_id=w.buyer_id)
      AND (${search}='' OR LOWER(COALESCE(b.display_name,w.buyer_id)) LIKE LOWER(${`%${search}%`}) OR LOWER(COALESCE(b.email,'')) LIKE LOWER(${`%${search}%`}))
      AND (${filter}='all' OR (${filter}='has_balance' AND (w.balance->>'availableCents')::bigint>0)
        OR (${filter}='never_used' AND NOT EXISTS(SELECT 1 FROM cashback_ledger_entries e LEFT JOIN cashback_buyer_aliases a ON a.merchant_id=e.merchant_id AND a.alias_buyer_id=e.buyer_id WHERE e.merchant_id=w.merchant_id AND COALESCE(a.canonical_buyer_id,e.buyer_id)=w.buyer_id AND e.type='redeem'))
        OR (${filter}='used' AND EXISTS(SELECT 1 FROM cashback_ledger_entries e LEFT JOIN cashback_buyer_aliases a ON a.merchant_id=e.merchant_id AND a.alias_buyer_id=e.buyer_id WHERE e.merchant_id=w.merchant_id AND COALESCE(a.canonical_buyer_id,e.buyer_id)=w.buyer_id AND e.type='redeem'))
        OR (${filter}='expiring' AND (w.balance->>'nextExpiryCents')::bigint>0 AND (w.balance->>'nextExpiryAt')::timestamptz <= now()+interval '7 days'))`;
    return this.repository.transaction(merchantId, async tx => {
      const count = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS total FROM cashback_wallets w LEFT JOIN buyer_accounts b ON b.global_user_id=w.buyer_id WHERE ${where}`);
      const rows = await tx.$queryRaw<Array<{ buyerId: string; displayName: string; email: string | null; balance: CashbackCustomer["balance"]; lastUsedAt: Date | null; ordersWithCashback: bigint }>>(Prisma.sql`
        SELECT w.buyer_id AS "buyerId",COALESCE(b.display_name,'Cliente WhatsApp') AS "displayName",b.email,w.balance,
          (SELECT max(e.occurred_at) FROM cashback_ledger_entries e LEFT JOIN cashback_buyer_aliases a ON a.merchant_id=e.merchant_id AND a.alias_buyer_id=e.buyer_id WHERE e.merchant_id=w.merchant_id AND COALESCE(a.canonical_buyer_id,e.buyer_id)=w.buyer_id AND e.type='redeem') AS "lastUsedAt",
          (SELECT count(DISTINCT e.order_id) FROM cashback_ledger_entries e LEFT JOIN cashback_buyer_aliases a ON a.merchant_id=e.merchant_id AND a.alias_buyer_id=e.buyer_id WHERE e.merchant_id=w.merchant_id AND COALESCE(a.canonical_buyer_id,e.buyer_id)=w.buyer_id AND e.type='redeem') AS "ordersWithCashback"
        FROM cashback_wallets w LEFT JOIN buyer_accounts b ON b.global_user_id=w.buyer_id WHERE ${where}
        ORDER BY (w.balance->>'availableCents')::bigint DESC,w.buyer_id ASC LIMIT ${p.pageSize} OFFSET ${p.offset}`);
      return { items: rows.map(row => ({ ...row, lastUsedAt: row.lastUsedAt?.toISOString() ?? null, ordersWithCashback: Number(row.ordersWithCashback) })), total: Number(count[0]!.total), page: p.page, pageSize: p.pageSize };
    });
  }

  async transactions(merchantId: string, q: CashbackListQuery, exportLimit?: number): Promise<CashbackPage<CashbackTransaction>> {
    const p = pagination(q, exportLimit); const { from, to } = range(q);
    if (q.type && !transactionTypes.has(q.type)) throw new CashbackError("cashback_transaction_type_invalid");
    if (q.buyerId && q.buyerId.length > 200) throw new CashbackError("cashback_buyer_invalid");
    const where = Prisma.sql`e.merchant_id=${merchantId} AND e.occurred_at>=${from} AND e.occurred_at<=${to}
      AND (${q.buyerId ?? ""}='' OR COALESCE(a.canonical_buyer_id,e.buyer_id)=${q.buyerId ?? ""}) AND (${q.type ?? ""}='' OR e.type=${q.type ?? ""})`;
    return this.repository.transaction(merchantId, async tx => {
      const count = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS total FROM cashback_ledger_entries e LEFT JOIN cashback_buyer_aliases a ON a.merchant_id=e.merchant_id AND a.alias_buyer_id=e.buyer_id WHERE ${where}`);
      const rows = await tx.$queryRaw<Array<{ id: string; merchant_id: string; buyer_id: string; type: CashbackTransaction["type"]; amount_cents: bigint; order_id: string | null; session_id: string | null; reason: string; actor_id: string | null; occurred_at: Date }>>(Prisma.sql`
        SELECT e.* FROM cashback_ledger_entries e LEFT JOIN cashback_buyer_aliases a ON a.merchant_id=e.merchant_id AND a.alias_buyer_id=e.buyer_id WHERE ${where} ORDER BY e.occurred_at DESC,e.id DESC LIMIT ${p.pageSize} OFFSET ${p.offset}`);
      return { items: rows.map(r => ({ id: r.id, merchantId: r.merchant_id, buyerId: q.buyerId ?? r.buyer_id, type: r.type, amountCents: Number(r.amount_cents), orderId: r.order_id, sessionId: r.session_id, reason: r.reason, actorId: r.actor_id, occurredAt: r.occurred_at.toISOString() })), total: Number(count[0]!.total), page: p.page, pageSize: p.pageSize };
    });
  }

  async metrics(merchantId: string, q: CashbackListQuery): Promise<CashbackMetrics> {
    const { from, to } = range(q); await this.service.reconcile(merchantId);
    return this.repository.transaction(merchantId, async tx => {
      const asOf = new Date();
      const rows = await tx.$queryRaw<Array<{ type: string; amount: bigint; buyers: bigint; orders: bigint }>>`SELECT type,SUM(amount_cents)::bigint AS amount,count(DISTINCT COALESCE(a.canonical_buyer_id,e.buyer_id))::bigint AS buyers,count(DISTINCT order_id)::bigint AS orders
        FROM cashback_ledger_entries e LEFT JOIN cashback_buyer_aliases a ON a.merchant_id=e.merchant_id AND a.alias_buyer_id=e.buyer_id
        WHERE e.merchant_id=${merchantId} AND occurred_at>=${from} AND occurred_at<=${to} GROUP BY type`;
      const sums = new Map(rows.map(x => [x.type, x])); const amount = (type: string) => Number(sums.get(type)?.amount ?? 0);
      const days = await tx.$queryRaw<Array<{ date: string; granted: bigint; redeemed: bigint }>>`
        WITH days AS (
          SELECT generate_series(
            ((${from}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp,
            ((${to}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp,
            interval '1 day')::date AS day
        ), movements AS (
          SELECT (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
            SUM(CASE WHEN type='grant' THEN amount_cents ELSE 0 END)::bigint AS granted,
            SUM(CASE WHEN type='redeem' THEN amount_cents ELSE 0 END)::bigint AS redeemed
          FROM cashback_ledger_entries
          WHERE merchant_id=${merchantId} AND occurred_at>=${from} AND occurred_at<=${to} AND type IN ('grant','redeem')
          GROUP BY 1
        )
        SELECT to_char(days.day,'YYYY-MM-DD') AS date,COALESCE(movements.granted,0)::bigint AS granted,
          COALESCE(movements.redeemed,0)::bigint AS redeemed
        FROM days LEFT JOIN movements ON movements.day=days.day ORDER BY days.day`;
      const wallets = await tx.$queryRaw<Array<{ pending: bigint; available: bigint; reserved: bigint }>>`SELECT COALESCE(SUM((balance->>'pendingCents')::bigint),0)::bigint AS pending,COALESCE(SUM((balance->>'availableCents')::bigint),0)::bigint AS available,COALESCE(SUM((balance->>'reservedCents')::bigint),0)::bigint AS reserved
        FROM cashback_wallets w WHERE merchant_id=${merchantId} AND NOT EXISTS(SELECT 1 FROM cashback_buyer_aliases a WHERE a.merchant_id=w.merchant_id AND a.alias_buyer_id=w.buyer_id)`;
      const revenue = await tx.$queryRaw<Array<{ amount: bigint }>>`SELECT COALESCE(SUM((q.data->>'orderTotalCents')::bigint),0)::bigint AS amount FROM cashback_earning_quotes q WHERE q.merchant_id=${merchantId} AND q.state='confirmed' AND (q.data->>'cashbackCents')::bigint>0 AND EXISTS(SELECT 1 FROM cashback_ledger_entries e WHERE e.merchant_id=q.merchant_id AND e.order_id=q.data->>'orderId' AND e.type='redeem' AND e.occurred_at>=${from} AND e.occurred_at<=${to})`;
      const monthParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(asOf);
      const month = `${monthParts.find(p => p.type === "year")!.value}-${monthParts.find(p => p.type === "month")!.value}`;
      const budget = await tx.$queryRaw<Array<{ committed_cents: bigint; issued_cents: bigint }>>`SELECT committed_cents,issued_cents FROM cashback_budget_periods WHERE merchant_id=${merchantId} AND period=${month}`;
      const program = await this.repository.program(tx, merchantId);
      return { from: from.toISOString(), to: to.toISOString(), asOf: asOf.toISOString(),
        dailyMovements: days.map(day => ({ date: day.date, grantedCents: Number(day.granted), redeemedCents: Number(day.redeemed) })),
        grantedCents: amount("grant"), releasedCents: amount("release"), redeemedCents: amount("redeem"), restoredCents: amount("restore"), expiredCents: amount("expire"), reversedCents: amount("reverse"), lossCents: amount("loss"),
        pendingCents: Number(wallets[0]?.pending ?? 0), availableCents: Number(wallets[0]?.available ?? 0), reservedCents: Number(wallets[0]?.reserved ?? 0), buyersGranted: Number(sums.get("grant")?.buyers ?? 0), buyersRedeemed: Number(sums.get("redeem")?.buyers ?? 0), ordersWithCashback: Number(sums.get("redeem")?.orders ?? 0), associatedRevenueCents: Number(revenue[0]?.amount ?? 0), budgetCommittedCents: Number(budget[0]?.committed_cents ?? 0), budgetIssuedCents: Number(budget[0]?.issued_cents ?? 0), budgetLimitCents: program.published?.monthlyBudgetCents ?? null };
    });
  }

  async exportCsv(merchantId: string, query: CashbackListQuery & { kind?: string }): Promise<string> {
    if (query.kind && !["customers", "transactions"].includes(query.kind)) throw new CashbackError("cashback_export_kind_invalid");
    let rows: unknown[][];
    if (query.kind === "customers") {
      const result = await this.customers(merchantId, query, 5000);
      if (result.total > 5000) throw new CashbackError("cashback_export_limit_exceeded_narrow_filters", 413);
      rows = [["Cliente", "Nome", "Email", "DisponivelCentavos", "PendenteCentavos", "ReservadoCentavos", "UtilizadoCentavos"], ...result.items.map(c => [c.buyerId, c.displayName, c.email, c.balance.availableCents, c.balance.pendingCents, c.balance.reservedCents, c.balance.usedCents])];
    } else {
      const result = await this.transactions(merchantId, query, 5000);
      if (result.total > 5000) throw new CashbackError("cashback_export_limit_exceeded_narrow_filters", 413);
      rows = [["Data", "Cliente", "Tipo", "ValorCentavos", "Pedido", "Motivo"], ...result.items.map(t => [t.occurredAt, t.buyerId, t.type, t.amountCents, t.orderId, t.reason])];
    }
    return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  }
}
