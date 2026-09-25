import type { Prisma, StrategyExecution } from "@prisma/client";
import type { MeasurementPlan } from "../domain/services/measurement-plan.js";

/** One MVCC statement for assignment, order state and client-reported visibility.
 * Never infer participants from buyers, publication, mutable routing or telemetry.
 * All quantities are aggregate; no buyer identities leave this reader. */
export async function readStrategyMeasurement(tx: Prisma.TransactionClient, execution: StrategyExecution,
  plan: MeasurementPlan, asOf: Date) {
  const merchantId = execution.merchantId;
  return tx.$queryRaw<Array<Record<string, bigint | number | string>>>`
    WITH assigned AS (
      SELECT a.id AS assignment_id, a.variant_id, a.arm, a.assigned_at,
        a.global_user_id AS assigned_buyer, s.*,
        a.assigned_at + (${plan.conversionWindowHours} * INTERVAL '1 hour') AS cutoff
      FROM strategy_assignments a
      JOIN checkout_sessions s ON s.merchant_id = a.merchant_id AND s.session_id = a.session_id
      WHERE a.merchant_id = ${merchantId} AND a.execution_id = ${execution.id}
    ), measured AS (
      SELECT a.*, o.orders, o.cents, o.other_currency, o.bad_amount,
        t.turns, t.published, t.displayed, t.provider_failed, t.provider_unknown, t.suppressed
      FROM assigned a
      LEFT JOIN LATERAL (
        SELECT count(*) AS orders,
          COALESCE(sum(round(order_total * 100)) FILTER (WHERE currency = 'BRL'), 0) AS cents,
          count(*) FILTER (WHERE currency <> 'BRL') AS other_currency,
          count(*) FILTER (WHERE order_total < 0 OR order_total * 100 <> trunc(order_total * 100)) AS bad_amount
        FROM completed_orders WHERE merchant_id = ${merchantId} AND session_id = a.session_id AND status = 'approved'
          AND completed_at >= a.assigned_at AND completed_at < a.cutoff AND completed_at <= ${asOf}
      ) o ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS turns,
          count(*) FILTER (WHERE p.decision = 'persisted' AND p.recorded_at <= ${asOf}) AS published,
          count(*) FILTER (WHERE d.recorded_at <= ${asOf}) AS displayed,
          count(*) FILTER (WHERE r.outcome = 'provider_failed' AND r.recorded_at <= ${asOf}) AS provider_failed,
          count(*) FILTER (WHERE r.turn_id IS NULL OR r.recorded_at > ${asOf} OR r.outcome = 'provider_unknown') AS provider_unknown,
          count(*) FILTER (WHERE p.decision = 'suppressed' AND p.recorded_at <= ${asOf}) AS suppressed
        FROM strategy_turns t
          LEFT JOIN strategy_turn_publications p ON p.turn_id = t.id AND p.merchant_id = t.merchant_id
          LEFT JOIN strategy_message_displays d ON d.turn_id = p.turn_id AND d.merchant_id = p.merchant_id
          LEFT JOIN strategy_turn_outcomes r ON r.turn_id = t.id AND r.merchant_id = t.merchant_id
        WHERE t.assignment_id = a.assignment_id AND t.merchant_id = ${merchantId} AND t.admitted_at <= ${asOf}
      ) t ON true
    ) SELECT variant_id AS variant, count(*) AS assigned,
      count(*) FILTER (WHERE cutoff <= ${asOf}) AS mature,
      count(*) FILTER (WHERE cutoff <= ${asOf} AND orders > 0) AS converted,
      COALESCE(sum(orders) FILTER (WHERE cutoff <= ${asOf}), 0) AS orders,
      COALESCE(sum(cents) FILTER (WHERE cutoff <= ${asOf}), 0) AS cents,
      count(*) FILTER (WHERE cutoff > ${asOf} AND orders > 0) AS pending_converted,
      COALESCE(sum(cents) FILTER (WHERE cutoff > ${asOf}), 0) AS pending_cents,
      count(*) FILTER (WHERE turns > 0) AS sessions_with_turn,
      count(*) FILTER (WHERE published > 0) AS sessions_with_publication,
      count(*) FILTER (WHERE displayed > 0) AS sessions_with_display,
      COALESCE(sum(turns), 0) AS turns, COALESCE(sum(published), 0) AS publications,
      COALESCE(sum(displayed), 0) AS displays, COALESCE(sum(provider_failed), 0) AS provider_failed,
      COALESCE(sum(provider_unknown), 0) AS provider_unknown, COALESCE(sum(suppressed), 0) AS suppressed,
      count(*) FILTER (WHERE assigned_at < ${execution.startedAt} OR assigned_at > ${asOf} OR assigned_at >= ${execution.endsAt}) AS outside_window,
      count(*) FILTER (WHERE created_at <> assigned_at) AS changed_entry,
      count(*) FILTER (WHERE cohort = 'holdout') AS holdout,
      count(*) FILTER (WHERE cohort IS DISTINCT FROM 'treatment') AS unknown_cohort,
      count(*) FILTER (WHERE assigned_buyer = '' OR assigned_buyer IS DISTINCT FROM global_user_id) AS changed_identity,
      count(*) FILTER (WHERE (arm = 'control' AND variant_id <> ${plan.controlVariantId})
        OR (arm = 'treatment' AND variant_id <> ${plan.treatmentVariantId}) OR arm NOT IN ('control', 'treatment')) AS invalid_arm,
      count(*) FILTER (WHERE cart->>'currency' IS DISTINCT FROM 'BRL') AS changed_currency,
      COALESCE(sum(other_currency), 0) AS other_currency, COALESCE(sum(bad_amount), 0) AS bad_amount
    FROM measured GROUP BY variant_id ORDER BY variant_id`;
}

export function strategyDeliveryMetrics(rows: Array<Record<string, bigint | number | string>>, plan: MeasurementPlan) {
  const arm = (id: string) => {
    const row = rows.find(r => r.variant === id);
    const n = (key: string) => Number(row?.[key] ?? 0);
    return { assigned: n("assigned"), mature: n("mature"), pending: n("assigned") - n("mature"),
      sessionsWithTurn: n("sessions_with_turn"), sessionsWithPublication: n("sessions_with_publication"),
      sessionsWithDisplay: n("sessions_with_display"), admittedTurns: n("turns"), publishedTurns: n("publications"),
      displayedTurns: n("displays"), failedProviderTurns: n("provider_failed"), unresolvedProviderTurns: n("provider_unknown"),
      suppressedTurns: n("suppressed"), pendingConvertedSessions: n("pending_converted"), pendingRevenueCents: n("pending_cents") };
  };
  return { definition: "strategy-assignment-delivery-v1", populationSource: "immutable_strategy_assignments",
    displayBasis: "authenticated_client_report_not_attention", control: arm(plan.controlVariantId), treatment: arm(plan.treatmentVariantId) };
}
