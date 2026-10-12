import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { Counter, Gauge } from "prom-client";
import { MetricsService } from "../../../shared/observability/metrics.service.js";

const statuses = {
  wallet_return: ["claimed", "unknown", "pending", "returned", "failed"],
  fee_contribution: ["approved", "observing", "unproven", "credited"],
} as const;
type Kind = keyof typeof statuses;
type Row = { kind: Kind; status: string; count: bigint; cents: bigint; oldest: Date | null };

/** These balances are certified journal credits, not permission to spend them.
 * All labels are bounded and aggregates survive worker/application restarts. */
@Injectable()
export class MarketplaceFundingJournalMetricsService {
  private readonly logger = new Logger(MarketplaceFundingJournalMetricsService.name);
  private readonly operations: Gauge;
  private readonly amounts: Gauge;
  private readonly age: Gauge;
  private readonly collected: Gauge;
  private readonly errors: Counter;
  private pending?: Promise<void>;
  constructor(private readonly prisma: PrismaClient, metrics: MetricsService) {
    const registers = [metrics.registry], collect = () => this.refresh();
    this.operations = new Gauge({ name: "marketplace_refund_funding_operations", help: "Persisted seller fee contribution and authorized wallet return journals",
      labelNames: ["kind", "status"], registers, collect });
    this.amounts = new Gauge({ name: "marketplace_refund_funding_certified_cents", help: "Certified fee net and original or residual wallet-return principal journal totals; not a spendable balance or payout permission",
      labelNames: ["kind"], registers, collect });
    this.age = new Gauge({ name: "marketplace_oldest_unresolved_refund_funding_seconds", help: "Age since original submission or approval of unresolved refund funding; GET retries never reset this age",
      labelNames: ["kind"], registers, collect });
    this.collected = new Gauge({ name: "marketplace_refund_funding_collected_timestamp_seconds", help: "Last successful collection of refund funding journals", registers, collect });
    this.errors = new Counter({ name: "marketplace_refund_funding_collection_errors_total", help: "Failed refund funding journal metric collections", registers });
    this.collected.set(0);
  }
  refresh(): Promise<void> {
    if (!this.pending) this.pending = this.read().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async read(): Promise<void> {
    try {
      const rows = await this.prisma.$queryRaw<Row[]>`
        SELECT 'wallet_return'::text AS kind, status, count(*)::bigint AS count,
          COALESCE(sum(amount_cents) FILTER (WHERE status='returned'),0)::bigint AS cents,
          min(submitted_at) FILTER (WHERE status IN ('unknown','pending')) AS oldest
        FROM (
          SELECT status, amount_cents, submitted_at FROM marketplace_asaas_wallet_returns
          UNION ALL
          SELECT status, amount_cents, submitted_at FROM marketplace_asaas_residual_wallet_returns
        ) wallet_returns GROUP BY status
        UNION ALL
        SELECT 'fee_contribution'::text AS kind, j.status, count(*)::bigint AS count,
          COALESCE(sum(c.credit_cents) FILTER (WHERE j.status='credited'),0)::bigint AS cents,
          min(j.created_at) FILTER (WHERE j.status IN ('approved','observing','unproven')) AS oldest
        FROM marketplace_refund_contribution_journals j
        LEFT JOIN marketplace_refund_contribution_credits c ON c.id=j.id GROUP BY j.status`;
      // Validate the entire snapshot before replacing any last-good metric.
      const seen = new Set<string>();
      for (const row of rows) {
        const key = `${row.kind}:${row.status}`;
        if (!(row.kind in statuses) || !(statuses[row.kind] as readonly string[]).includes(row.status) || seen.has(key) ||
            !Number.isSafeInteger(Number(row.count)) || Number(row.count) < 0 || !Number.isSafeInteger(Number(row.cents)) || Number(row.cents) < 0 ||
            row.oldest !== null && (!Number.isFinite(row.oldest.getTime()) || row.oldest.getTime() > Date.now() + 60_000)) throw Error("invalid_journal_metric_snapshot");
        seen.add(key);
      }
      const now = Date.now();
      this.operations.reset(); this.amounts.reset(); this.age.reset();
      for (const kind of Object.keys(statuses) as Kind[]) {
        for (const status of statuses[kind]) this.operations.set({ kind, status }, Number(rows.find(row => row.kind === kind && row.status === status)?.count ?? 0));
        const own = rows.filter(row => row.kind === kind);
        this.amounts.set({ kind }, own.reduce((total, row) => total + Number(row.cents), 0));
        const oldest = own.flatMap(row => row.oldest ? [row.oldest.getTime()] : []);
        this.age.set({ kind }, oldest.length ? Math.max(0, (now - Math.min(...oldest)) / 1000) : 0);
      }
      this.collected.set(now / 1000);
    } catch {
      this.errors.inc(); this.logger.warn({ event: "marketplace_refund_funding_metrics_failed" });
    }
  }
}
