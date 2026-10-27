import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { OBSERVATION_REPOSITORY_PORT, type ObservationRepositoryPort } from "../../domain/ports/observation-repository.port.js";
import { ObservationEntity } from "../../domain/entities/observation.entity.js";

export interface ObserveMetricsInput {
  merchant_id: string;
  window_start: Date;
  window_end: Date;
  as_of?: Date;
  conversion_window_hours?: number;
}
export interface ObserveMetricsOutput {
  observation_id: string;
  is_new: boolean;
  data_ready: boolean;
  missing_metrics: string[];
  top_abandonment_reason: string;
  conversion_rate: number | null;
}
type Counts = Record<string, number | bigint | string>;

@Injectable()
export class ObserveMetricsUseCase {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(OBSERVATION_REPOSITORY_PORT) private readonly observationRepo: ObservationRepositoryPort,
  ) {}

  async execute(input: ObserveMetricsInput): Promise<ObserveMetricsOutput> {
    const { merchant_id: merchantId, window_start: start, window_end: end } = input;
    const asOf = input.as_of ?? end;
    const hours = input.conversion_window_hours ?? 24;
    if (!merchantId || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
      || !Number.isFinite(asOf.getTime()) || start >= end || end > asOf
      || !Number.isInteger(hours) || hours < 1 || hours > 720) throw new Error("INVALID_OBSERVATION_WINDOW");

    // One database snapshot and one row per session before any rate is computed.
    const [row] = await this.prisma.$queryRaw<Counts[]>`
      WITH cohort AS (
        SELECT s.*, s.created_at + (${hours} * INTERVAL '1 hour') AS cutoff
        FROM checkout_sessions s
        WHERE s.merchant_id = ${merchantId} AND s.created_at >= ${start} AND s.created_at < ${end}
      ), measured AS (
        SELECT s.session_id, s.cutoff <= ${asOf} AS mature,
          COALESCE(e.names, ARRAY[]::text[]) AS names,
          COALESCE(o.orders, 0) AS orders, COALESCE(o.cents, 0) AS cents,
          COALESCE(o.other_currency, 0) AS other_currency,
          EXISTS (
            SELECT 1 FROM checkout_sessions prior
            JOIN completed_orders po ON po.merchant_id = prior.merchant_id AND po.session_id = prior.session_id
            WHERE prior.merchant_id = ${merchantId} AND prior.global_user_id = s.global_user_id
              AND po.status = 'approved' AND po.completed_at < s.created_at
          ) AS returning_customer
        FROM cohort s
        LEFT JOIN LATERAL (
          SELECT array_agg(DISTINCT event_name) AS names FROM checkout_events
          WHERE merchant_id = ${merchantId} AND session_id = s.session_id
            AND occurred_at >= s.created_at AND occurred_at < s.cutoff AND occurred_at <= ${asOf}
        ) e ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS orders,
            COALESCE(sum(round(order_total * 100)) FILTER (WHERE currency = 'BRL'), 0) AS cents,
            count(*) FILTER (WHERE currency <> 'BRL') AS other_currency
          FROM completed_orders
          WHERE merchant_id = ${merchantId} AND session_id = s.session_id AND status = 'approved'
            AND completed_at >= s.created_at AND completed_at < s.cutoff AND completed_at <= ${asOf}
        ) o ON true
      )
      SELECT count(*) AS total, count(*) FILTER (WHERE mature) AS mature,
        count(*) FILTER (WHERE mature AND orders > 0) AS converted,
        count(*) FILTER (WHERE NOT mature AND orders > 0) AS provisional_converted,
        count(*) FILTER (WHERE cardinality(names) > 0) AS with_events,
        count(*) FILTER (WHERE 'checkout_started' = ANY(names)) AS started,
        count(*) FILTER (WHERE 'shipping_option_selected' = ANY(names)) AS shipping,
        count(*) FILTER (WHERE 'payment_method_selected' = ANY(names)) AS payment,
        count(*) FILTER (WHERE mature AND orders = 0) AS unconverted,
        count(*) FILTER (WHERE mature AND orders = 0 AND 'payment_method_selected' = ANY(names)) AS abandoned_payment,
        count(*) FILTER (WHERE mature AND orders = 0 AND 'shipping_option_selected' = ANY(names)
          AND NOT 'payment_method_selected' = ANY(names)) AS abandoned_shipping,
        count(*) FILTER (WHERE mature AND orders = 0 AND 'shipping_objection_detected' = ANY(names)) AS shipping_objections,
        count(*) FILTER (WHERE mature AND orders = 0 AND 'payment_failed' = ANY(names)) AS payment_objections,
        count(*) FILTER (WHERE mature AND orders = 0 AND NOT 'shipping_objection_detected' = ANY(names)
          AND NOT 'payment_failed' = ANY(names)) AS unknown_objections,
        count(*) FILTER (WHERE 'cross_sell_shown' = ANY(names)) AS cross_shown,
        count(*) FILTER (WHERE 'cross_sell_shown' = ANY(names) AND 'cross_sell_accepted' = ANY(names)) AS cross_accepted,
        count(*) FILTER (WHERE returning_customer) AS returning_count,
        COALESCE(sum(cents) FILTER (WHERE mature), 0) AS revenue,
        COALESCE(sum(orders) FILTER (WHERE mature), 0) AS orders,
        COALESCE(sum(other_currency), 0) AS other_currency
      FROM measured`;
    const n = (key: string) => Number(row?.[key] ?? 0);
    const missing = [
      ...(n("mature") < 30 ? ["minimum_mature_session_sample"] : []),
      ...(n("with_events") === 0 ? ["checkout_events"] : []),
      ...(n("started") === 0 ? ["checkout_started_event"] : []),
      ...(n("other_currency") > 0 ? ["mixed_order_currencies"] : []),
    ];
    const ready = missing.length === 0;
    const objections = { shipping_cost_count: n("shipping_objections"), payment_count: n("payment_objections"),
      price_count: 0, trust_count: 0, unknown_count: n("unknown_objections") };
    const top = Object.entries(objections).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0]?.[0].replace("_count", "") ?? "unknown";
    const observation = ObservationEntity.create({
      merchant_id: merchantId, observation_window_start: start, observation_window_end: end,
      funnel: { total_sessions: n("total"), started_checkout: n("started"), reached_shipping: n("shipping"),
        reached_payment: n("payment"), completed_order: n("converted"), conversion_rate: ready ? n("converted") / n("mature") : null },
      abandonment: { abandoned_at_shipping: n("abandoned_shipping"), abandoned_at_payment: n("abandoned_payment"),
        abandonment_rate: ready ? n("unconverted") / n("mature") : null, top_abandonment_objection: top },
      objections,
      cross_sell: { suggestions_shown: n("cross_shown"), suggestions_accepted: n("cross_accepted"),
        acceptance_rate: n("cross_shown") ? n("cross_accepted") / n("cross_shown") : 0, top_suggested_skus: [] },
      cohorts: { returning_customers_rate: n("total") ? n("returning_count") / n("total") : 0,
        new_customers_rate: n("total") ? 1 - n("returning_count") / n("total") : 0,
        high_discount_sensitivity_rate: null, low_discount_sensitivity_rate: null },
      revenue: { total_revenue_cents: n("revenue"), total_orders: n("orders"),
        avg_order_value_cents: n("orders") ? Math.round(n("revenue") / n("orders")) : 0 },
      // Compatibility field only. Unknown costs must never become evidence of profit.
      ai_costs_cents: 0,
      data_quality: { status: ready ? "ready" : "insufficient_data", sample_size: n("mature"),
        observation_window_start: start.toISOString(), observation_window_end: end.toISOString(),
        metric_definition_version: "checkout-session-cohort-v2", as_of: asOf.toISOString(),
        conversion_window_hours: hours, mature_sessions: n("mature"), pending_sessions: n("total") - n("mature"),
        provisional_converted_sessions: n("provisional_converted"), revenue_currency: "BRL",
        order_state_basis: "recorded_state_at_collection",
        sources: { checkout_sessions: "measured", completed_orders: "measured",
          checkout_events: n("with_events") ? "measured" : "unavailable", ai_costs: "unavailable",
          contribution: "unavailable", price_objections: "unavailable", trust_objections: "unavailable",
          experiment_inference: "unavailable", buyer_discount_sensitivity: "unavailable" }, missing_metrics: missing },
    });
    const existing = await this.observationRepo.findByFingerprint(observation.fingerprint);
    if (!existing) await this.observationRepo.save(observation);
    const saved = existing ?? observation;
    return { observation_id: saved.id, is_new: !existing, data_ready: saved.isReadyForHypothesis(),
      missing_metrics: saved.data_quality.missing_metrics, top_abandonment_reason: saved.abandonment.top_abandonment_objection,
      conversion_rate: saved.funnel.conversion_rate };
  }
}
