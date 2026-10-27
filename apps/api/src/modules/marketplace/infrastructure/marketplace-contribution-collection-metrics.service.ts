import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { Counter, Gauge } from "prom-client";
import { MetricsService } from "../../../shared/observability/metrics.service.js";

const statuses = { checkout: ["approved", "creating", "open", "paid", "credited", "expired", "unproven"],
  seller_fee: ["approved", "creating", "open", "paid", "credited", "expired", "unproven"], seller_fee_excess: ["held", "unknown", "pending", "failed", "returned"],
  seller_obligation: ["outstanding", "closed", "excess_held"],
  excess_return: ["held", "unknown", "pending", "failed", "returned"] } as const;
type Kind = keyof typeof statuses;
type Row = { kind: Kind; status: string; count: bigint; cents: bigint; oldest: Date | null };

/** Separate collection and seller excess obligations from the certified refund budget. */
@Injectable()
export class MarketplaceContributionCollectionMetricsService {
  private readonly logger = new Logger(MarketplaceContributionCollectionMetricsService.name);
  private readonly operations: Gauge;
  private readonly excess: Gauge;
  private readonly feeExcess: Gauge;
  private readonly feePending: Gauge;
  private readonly age: Gauge;
  private readonly collected: Gauge;
  private readonly errors: Counter;
  private pending?: Promise<void>;
  constructor(private readonly prisma: PrismaClient, metrics: MetricsService) {
    const registers = [metrics.registry], collect = () => this.refresh();
    this.operations = new Gauge({ name: "marketplace_contribution_collection_operations", help: "Durable hosted contribution collections and separate seller excess returns",
      labelNames: ["kind", "status"], registers, collect });
    this.excess = new Gauge({ name: "marketplace_contribution_excess_outstanding_cents", help: "Certified collected excess still owed to sellers; never available for the buyer refund", registers, collect });
    this.feeExcess = new Gauge({ name: "marketplace_seller_fee_excess_outstanding_cents", help: "Certified fee collection excess held as a seller liability; grants no funding or payout permission", registers, collect });
    this.feePending = new Gauge({ name: "marketplace_seller_dispute_fee_outstanding_cents", help: "Proportional seller dispute fees without certified net collection", registers, collect });
    this.age = new Gauge({ name: "marketplace_contribution_collection_oldest_unresolved_seconds", help: "Age since original submission or excess certification; GET recovery never resets it",
      labelNames: ["kind"], registers, collect });
    this.collected = new Gauge({ name: "marketplace_contribution_collection_collected_timestamp_seconds", help: "Last successful collection of contribution collection and excess journals", registers, collect });
    this.errors = new Counter({ name: "marketplace_contribution_collection_errors_total", help: "Failed contribution collection metric snapshots", registers });
    this.collected.set(0);
  }
  refresh(): Promise<void> {
    if (!this.pending) this.pending = this.read().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async read(): Promise<void> {
    try {
      const rows = await this.prisma.$queryRaw<Row[]>`
        SELECT 'checkout'::text AS kind,status,count(*)::bigint AS count,0::bigint AS cents,
          min(COALESCE(submitted_at,created_at)) FILTER (WHERE status IN ('creating','paid','unproven')) AS oldest
        FROM marketplace_contribution_checkouts GROUP BY status
        UNION ALL
        SELECT 'excess_return'::text AS kind,status,count(*)::bigint AS count,
          COALESCE(sum(amount_cents-returned_cents) FILTER (WHERE status<>'returned'),0)::bigint AS cents,
          min(created_at) FILTER (WHERE status<>'returned') AS oldest
        FROM marketplace_contribution_excess_liabilities GROUP BY status
        UNION ALL
        SELECT 'seller_fee'::text AS kind,status,count(*)::bigint AS count,0::bigint AS cents,
          min(COALESCE(submitted_at,created_at)) FILTER (WHERE status IN ('creating','paid','unproven')) AS oldest
        FROM marketplace_seller_fee_collections GROUP BY status
        UNION ALL
        SELECT 'seller_fee_excess'::text AS kind,status,count(*)::bigint AS count,
          sum(outstanding)::bigint AS cents,min(created_at) FILTER (WHERE outstanding>0) AS oldest
        FROM (SELECT c.created_at,marketplace_fee_excess_outstanding('seller',c.id) AS outstanding,
          CASE WHEN j.excess_return_status='returned' AND NOT marketplace_fee_excess_return_valid('seller',c.id)
            THEN 'held' ELSE COALESCE(j.excess_return_status,'held') END AS status
          FROM marketplace_seller_fee_credits c JOIN marketplace_seller_fee_collections j ON j.id=c.id
          WHERE c.excess_liability_cents>0) fee_returns GROUP BY status
        UNION ALL
        SELECT 'seller_obligation'::text AS kind,status,count(*)::bigint AS count,sum(pending)::bigint AS cents,
          min(created_at) FILTER(WHERE status<>'closed') AS oldest FROM (
          SELECT c.created_at,GREATEST(COALESCE((c.evidence->>'sellerDisputeFeeCents')::bigint,(c.evidence->>'disputeFeeCents')::bigint)-COALESCE(v.collected,0),0) AS pending,
            CASE WHEN marketplace_seller_dispute_obligation_valid(c.debt_id) THEN 'closed'
              WHEN COALESCE(v.collected,0)=COALESCE((c.evidence->>'sellerDisputeFeeCents')::bigint,(c.evidence->>'disputeFeeCents')::bigint) AND COALESCE(v.excess,0)>0 THEN 'excess_held'
              ELSE 'outstanding' END AS status
          FROM marketplace_debt_principal_extinctions c LEFT JOIN LATERAL (
            SELECT sum(credit_cents) AS collected,sum(marketplace_fee_excess_outstanding('seller',id)) AS excess
            FROM marketplace_seller_fee_credits WHERE fee_certificate_id=c.id) v ON true
          WHERE (c.evidence->'version'='2'::jsonb AND (c.evidence->>'sellerDisputeFeeCents')::bigint>0)
            OR (COALESCE((c.evidence->>'sellerDisputeFeeCents')::bigint,(c.evidence->>'disputeFeeCents')::bigint)=0
              AND marketplace_debt_principal_extinction_valid(c.debt_id))
        ) obligations GROUP BY status`;
      const seen = new Set<string>();
      const now = Date.now();
      for (const row of rows) {
        const key = `${row.kind}:${row.status}`;
        if (!Object.hasOwn(statuses,row.kind) || !(statuses[row.kind] as readonly string[]).includes(row.status) || seen.has(key) ||
            !Number.isSafeInteger(Number(row.count)) || Number(row.count)<0 || !Number.isSafeInteger(Number(row.cents)) || Number(row.cents)<0 ||
            ["checkout","seller_fee"].includes(row.kind) && Number(row.cents)!==0 || row.status==="returned" && Number(row.cents)!==0 ||
            row.kind==="seller_obligation" && row.status==="closed" && (Number(row.cents)!==0 || row.oldest!==null) ||
            row.oldest!==null && (!(row.oldest instanceof Date) || !Number.isFinite(row.oldest.getTime()) || row.oldest.getTime()>now+60_000)) throw Error("invalid_collection_snapshot");
        seen.add(key);
      }
      const excess = rows.filter(row=>row.kind==="excess_return").reduce((total,row)=>total+Number(row.cents),0);
      const feeExcess = rows.filter(row=>row.kind==="seller_fee_excess").reduce((total,row)=>total+Number(row.cents),0);
      const feePending = rows.filter(row=>row.kind==="seller_obligation").reduce((total,row)=>total+Number(row.cents),0);
      if (!Number.isSafeInteger(excess) || !Number.isSafeInteger(feeExcess) || !Number.isSafeInteger(feePending)) throw Error("invalid_collection_total");
      this.operations.reset(); this.age.reset();
      for (const kind of Object.keys(statuses) as Kind[]) {
        for (const status of statuses[kind]) this.operations.set({kind,status},Number(rows.find(row=>row.kind===kind && row.status===status)?.count ?? 0));
        const oldest=rows.filter(row=>row.kind===kind).flatMap(row=>row.oldest ? [row.oldest.getTime()] : []);
        this.age.set({kind},oldest.length ? Math.max(0,(now-Math.min(...oldest))/1000) : 0);
      }
      this.excess.set(excess); this.feeExcess.set(feeExcess); this.feePending.set(feePending); this.collected.set(now/1000);
    } catch { this.errors.inc(); this.logger.warn({event:"marketplace_contribution_collection_metrics_failed"}); }
  }
}
