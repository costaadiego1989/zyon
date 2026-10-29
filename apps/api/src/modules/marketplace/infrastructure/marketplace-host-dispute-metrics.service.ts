import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { Counter, Gauge } from "prom-client";
import { MetricsService } from "../../../shared/observability/metrics.service.js";

type HostSnapshot = { certified: bigint; principal_cents: bigint; fee_cents: bigint; unproven: bigint;
  obligations: bigint; credit_cents: bigint; processing_cents: bigint; excess_cents: bigint;
  unresolved: bigint; oldest: Date | null };

/** Native principal restoration and host-paid fees are separate facts. A fee
 * debited from the platform account is never a payment by the connected host. */
@Injectable()
export class MarketplaceHostDisputeMetricsService {
  private readonly logger = new Logger(MarketplaceHostDisputeMetricsService.name);
  private readonly certified: Gauge;
  private readonly principal: Gauge;
  private readonly fees: Gauge;
  private readonly unproven: Gauge;
  private readonly obligations: Gauge;
  private readonly credits: Gauge;
  private readonly processing: Gauge;
  private readonly excess: Gauge;
  private readonly unresolved: Gauge;
  private readonly age: Gauge;
  private readonly collected: Gauge;
  private readonly errors: Counter;
  private pending?: Promise<void>;

  constructor(private readonly prisma: PrismaClient, metrics: MetricsService) {
    const registers = [metrics.registry], collect = () => this.refresh();
    this.certified = new Gauge({ name: "marketplace_certified_host_principal_extinctions", help: "Valid host principal restoration certificates; not transfer recoveries or paid host fees", registers, collect });
    this.principal = new Gauge({ name: "marketplace_extinguished_host_principal_cents", help: "Host principal extinguished by independently certified native restoration in BRL cents", registers, collect });
    this.fees = new Gauge({ name: "marketplace_host_dispute_fee_outstanding_cents", help: "Host proportional dispute fee still uncollected after certified principal restoration in BRL cents", registers, collect });
    this.unproven = new Gauge({ name: "marketplace_unproven_host_principal_extinctions", help: "Host principal certificates or extinguished debts without matching immutable native evidence and outbox", registers, collect });
    this.obligations = new Gauge({ name: "marketplace_certified_host_dispute_obligations", help: "Host obligations closed with independently certified fee receipts and zero excess", registers, collect });
    this.credits = new Gauge({ name: "marketplace_host_dispute_fee_collected_cents", help: "Independent certified available net applied to proportional host dispute fees in BRL cents", registers, collect });
    this.processing = new Gauge({ name: "marketplace_host_dispute_fee_processing_cents", help: "Processing fees borne by the host for independently collected dispute fee receipts in BRL cents", registers, collect });
    this.excess = new Gauge({ name: "marketplace_host_fee_excess_outstanding_cents", help: "Certified host fee collection excess held as a separate host liability in BRL cents", registers, collect });
    this.unresolved = new Gauge({ name: "marketplace_host_fee_collection_unresolved", help: "Host fee submissions awaiting native GET reconciliation", registers, collect });
    this.age = new Gauge({ name: "marketplace_host_fee_collection_oldest_unresolved_seconds", help: "Age of original unresolved host fee submission; GET observation never resets it", registers, collect });
    this.collected = new Gauge({ name: "marketplace_host_dispute_metrics_collected_timestamp_seconds", help: "Last successful host dispute metric snapshot", registers, collect });
    this.errors = new Counter({ name: "marketplace_host_dispute_metrics_collection_errors_total", help: "Failed collections of host principal and pending fee metrics", registers });
    this.collected.set(0);
  }

  refresh(): Promise<void> {
    if (!this.pending) this.pending = this.read().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async read(): Promise<void> {
    try {
      const [row] = await this.prisma.$queryRaw<HostSnapshot[]>`
        WITH host_candidates AS (
          SELECT payout_id FROM marketplace_host_debts WHERE status='extinguished'
          UNION SELECT payout_id FROM marketplace_host_principal_extinctions
        ), audited AS (
          SELECT c.evidence, marketplace_host_principal_extinction_valid(candidate.payout_id) AS valid,
            marketplace_host_dispute_obligation_valid(candidate.payout_id) AS obligation_valid,
            COALESCE(v.credit_cents,0) AS credit_cents,COALESCE(v.processing_cents,0) AS processing_cents,
            COALESCE(v.excess_cents,0) AS excess_cents
          FROM host_candidates candidate
          LEFT JOIN marketplace_host_principal_extinctions c ON c.payout_id=candidate.payout_id
          LEFT JOIN LATERAL (
            SELECT sum(credit_cents)::bigint AS credit_cents,sum(processing_fee_cents)::bigint AS processing_cents,
              sum(marketplace_fee_excess_outstanding('host',id))::bigint AS excess_cents FROM marketplace_host_fee_credits
            WHERE fee_certificate_id=c.id AND marketplace_host_fee_credit_valid(id)
          ) v ON true
        ) SELECT count(*) FILTER (WHERE valid IS TRUE)::bigint AS certified,
          COALESCE(sum((evidence->>'amountCents')::bigint) FILTER (WHERE valid IS TRUE),0)::bigint AS principal_cents,
          COALESCE(sum(GREATEST((evidence->>'hostDisputeFeeCents')::bigint-credit_cents,0)) FILTER (WHERE valid IS TRUE),0)::bigint AS fee_cents,
          count(*) FILTER (WHERE valid IS NOT TRUE)::bigint AS unproven,
          count(*) FILTER (WHERE valid IS TRUE AND obligation_valid IS TRUE)::bigint AS obligations,
          COALESCE(sum(credit_cents) FILTER (WHERE valid IS TRUE),0)::bigint AS credit_cents,
          COALESCE(sum(processing_cents) FILTER (WHERE valid IS TRUE),0)::bigint AS processing_cents,
          COALESCE(sum(excess_cents) FILTER (WHERE valid IS TRUE),0)::bigint AS excess_cents,
          (SELECT count(*)::bigint FROM marketplace_host_fee_collections WHERE status IN ('creating','open','paid','unproven')
            OR status='credited' AND excess_return_status IN ('unknown','pending')) AS unresolved,
          (SELECT min(CASE WHEN status='credited' THEN excess_return_submitted_at ELSE submitted_at END)
            FROM marketplace_host_fee_collections WHERE status IN ('creating','open','paid','unproven')
            OR status='credited' AND excess_return_status IN ('unknown','pending')) AS oldest FROM audited`;
      const now=Date.now();
      if (!row || [row.certified, row.principal_cents, row.fee_cents, row.unproven, row.obligations,
        row.credit_cents, row.processing_cents, row.excess_cents, row.unresolved].some(value =>
        (typeof value !== "bigint" && typeof value !== "number") || !Number.isSafeInteger(Number(value)) || Number(value) < 0) ||
        row.obligations>row.certified || row.oldest!==null && (!(row.oldest instanceof Date) || !Number.isFinite(row.oldest.getTime()) || row.oldest.getTime()>now+60_000) ||
        (Number(row.unresolved)===0)!==(row.oldest===null)) throw Error("invalid_host_dispute_metric_snapshot");
      this.certified.set(Number(row.certified));
      this.principal.set(Number(row.principal_cents));
      this.fees.set(Number(row.fee_cents));
      this.unproven.set(Number(row.unproven));
      this.obligations.set(Number(row.obligations));
      this.credits.set(Number(row.credit_cents));
      this.processing.set(Number(row.processing_cents));
      this.excess.set(Number(row.excess_cents));
      this.unresolved.set(Number(row.unresolved));
      this.age.set(row.oldest ? Math.max(0,(now-row.oldest.getTime())/1000) : 0);
      this.collected.set(now / 1000);
    } catch {
      this.errors.inc();
      this.logger.warn({ event: "marketplace_host_dispute_metrics_failed" });
    }
  }
}
