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
      SELECT a.*, o.orders, o.cents, o.other_currency, o.bad_amount, o.cost_snapshots, o.priced_orders, o.catalog_cost,
        o.linked_payments, o.confirmed_payments, o.platform_fees, o.provider_fees,
        st.reason AS stop_reason,
        t.turns, t.published, t.displayed, t.provider_failed, t.provider_unknown, t.suppressed,
        t.ai_priced, t.ai_not_dispatched, t.ai_cost, t.ai_held, t.ai_currencies, t.ai_overruns
      FROM assigned a
      LEFT JOIN strategy_assignment_stops st ON st.assignment_id = a.assignment_id AND st.merchant_id = ${merchantId}
        AND st.stopped_at <= ${asOf}
      LEFT JOIN LATERAL (
        SELECT count(*) AS orders,
          count(c.order_id) AS cost_snapshots, count(c.product_cost_cents) AS priced_orders,
          COALESCE(sum(c.product_cost_cents), 0) AS catalog_cost,
          count(pi.id) AS linked_payments,
          count(*) FILTER (WHERE fees.verified) AS confirmed_payments,
          COALESCE(sum(ps.confirmed_platform_fee_cents) FILTER (WHERE fees.verified), 0) AS platform_fees,
          COALESCE(sum(ps.confirmed_provider_fee_cents) FILTER (WHERE fees.verified), 0) AS provider_fees,
          COALESCE(sum(round(order_total * 100)) FILTER (WHERE o.currency = 'BRL'), 0) AS cents,
          count(*) FILTER (WHERE o.currency <> 'BRL') AS other_currency,
          count(*) FILTER (WHERE order_total < 0 OR order_total * 100 <> trunc(order_total * 100)) AS bad_amount
        FROM completed_orders o LEFT JOIN strategy_order_cost_snapshots c
          ON c.order_id = o.id AND c.merchant_id = o.merchant_id AND c.captured_at <= ${asOf}
        LEFT JOIN payment_intents pi ON pi.merchant_id = o.merchant_id AND pi.session_id = o.session_id
          AND pi.provider_payment_id = o.external_order_id AND length(trim(o.external_order_id)) > 0 AND pi.created_at <= ${asOf}
        LEFT JOIN payment_settlements pp ON pp.merchant_id = o.merchant_id AND pp.payment_intent_id = pi.id
          AND pp.sequence = 1 AND pp.created_at <= ${asOf}
        -- Each observation is a snapshot, not a fee to add. Select the latest
        -- recorded observation first, including blocked/incomplete observations.
        LEFT JOIN LATERAL (
          SELECT ps.* FROM payment_settlements ps
          WHERE ps.merchant_id = o.merchant_id AND ps.payment_intent_id = pi.id AND ps.created_at <= ${asOf}
          ORDER BY ps.sequence DESC LIMIT 1
        ) ps ON true
        LEFT JOIN LATERAL (
          SELECT pi.status = 'approved' AND pi.currency = 'BRL' AND o.currency = 'BRL'
            AND pi.amount_cents = o.order_total * 100 AND pi.approved_amount_cents = pi.amount_cents
            AND ps.status = 'confirmed' AND ps.currency = pi.currency
            AND pp.status = 'planned' AND pp.provider = ps.provider AND pp.currency = ps.currency
            AND pp.planned_gross_cents = pi.amount_cents
            AND ps.provider_payment_id = pi.provider_payment_id
            AND ps.occurred_at <= ${asOf} AND ps.confirmed_at <= ${asOf}
            AND ps.planned_gross_cents = pi.amount_cents AND ps.confirmed_gross_cents = pi.amount_cents
            AND ps.confirmed_platform_fee_cents >= 0 AND ps.confirmed_provider_fee_cents >= 0
            AND ps.confirmed_merchant_net_cents >= 0
            AND ps.confirmed_gross_cents::bigint = ps.confirmed_platform_fee_cents::bigint
              + ps.confirmed_provider_fee_cents::bigint + ps.confirmed_merchant_net_cents::bigint AS verified
        ) fees ON true
        WHERE o.merchant_id = ${merchantId} AND o.session_id = a.session_id AND o.status = 'approved'
          AND o.completed_at >= a.assigned_at AND o.completed_at < a.cutoff AND o.completed_at <= ${asOf}
      ) o ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS turns,
          count(*) FILTER (WHERE p.decision = 'persisted' AND p.recorded_at <= ${asOf}) AS published,
          count(*) FILTER (WHERE d.recorded_at <= ${asOf}) AS displayed,
          count(*) FILTER (WHERE r.outcome = 'provider_failed' AND r.recorded_at <= ${asOf}) AS provider_failed,
          count(*) FILTER (WHERE r.turn_id IS NULL OR r.recorded_at > ${asOf} OR r.outcome = 'provider_unknown') AS provider_unknown,
          count(*) FILTER (WHERE p.decision = 'suppressed' AND p.recorded_at <= ${asOf}) AS suppressed,
          count(*) FILTER (WHERE b.state IN ('settled','overrun') AND b.settled_at <= ${asOf}
            AND u.cost_status = 'estimated' AND u.cost_micros IS NOT NULL) AS ai_priced,
          count(*) FILTER (WHERE (b.state = 'released' AND b.settled_at <= ${asOf} AND u.cost_status = 'not_incurred')
            OR (b.turn_id IS NULL AND r.outcome = 'provider_not_dispatched' AND r.recorded_at <= ${asOf})) AS ai_not_dispatched,
          COALESCE(sum(u.cost_micros) FILTER (WHERE b.state IN ('settled','overrun') AND b.settled_at <= ${asOf}
            AND u.cost_status = 'estimated'), 0) AS ai_cost,
          COALESCE(sum(b.amount_micros) FILTER (WHERE b.settled_at IS NULL OR b.settled_at > ${asOf}), 0) AS ai_held,
          string_agg(DISTINCT b.currency, ',') AS ai_currencies,
          count(*) FILTER (WHERE b.state = 'overrun' AND b.settled_at <= ${asOf}) AS ai_overruns
        FROM strategy_turns t
          LEFT JOIN strategy_turn_publications p ON p.turn_id = t.id AND p.merchant_id = t.merchant_id
          LEFT JOIN strategy_message_displays d ON d.turn_id = p.turn_id AND d.merchant_id = p.merchant_id
          LEFT JOIN strategy_turn_outcomes r ON r.turn_id = t.id AND r.merchant_id = t.merchant_id
          LEFT JOIN strategy_ai_reservations b ON b.turn_id = t.id AND b.merchant_id = t.merchant_id AND b.created_at <= ${asOf}
          LEFT JOIN ai_usage_events u ON u.idempotency_key = b.usage_key AND u.merchant_id = b.merchant_id AND u.completed_at <= ${asOf}
        WHERE t.assignment_id = a.assignment_id AND t.merchant_id = ${merchantId} AND t.admitted_at <= ${asOf}
      ) t ON true
    ) SELECT variant_id AS variant, count(*) AS assigned,
      count(*) FILTER (WHERE cutoff <= ${asOf}) AS mature,
      count(*) FILTER (WHERE cutoff <= ${asOf} AND orders > 0) AS converted,
      COALESCE(sum(orders) FILTER (WHERE cutoff <= ${asOf}), 0) AS orders,
      COALESCE(sum(cents) FILTER (WHERE cutoff <= ${asOf}), 0) AS cents,
      COALESCE(sum(cost_snapshots) FILTER (WHERE cutoff <= ${asOf}), 0) AS cost_snapshots,
      COALESCE(sum(priced_orders) FILTER (WHERE cutoff <= ${asOf}), 0) AS priced_orders,
      COALESCE(sum(catalog_cost) FILTER (WHERE cutoff <= ${asOf}), 0) AS catalog_cost,
      COALESCE(sum(linked_payments) FILTER (WHERE cutoff <= ${asOf}), 0) AS linked_payments,
      COALESCE(sum(confirmed_payments) FILTER (WHERE cutoff <= ${asOf}), 0) AS confirmed_payments,
      COALESCE(sum(platform_fees) FILTER (WHERE cutoff <= ${asOf}), 0) AS platform_fees,
      COALESCE(sum(provider_fees) FILTER (WHERE cutoff <= ${asOf}), 0) AS provider_fees,
      count(*) FILTER (WHERE cutoff > ${asOf} AND orders > 0) AS pending_converted,
      COALESCE(sum(cents) FILTER (WHERE cutoff > ${asOf}), 0) AS pending_cents,
      count(*) FILTER (WHERE turns > 0) AS sessions_with_turn,
      count(*) FILTER (WHERE published > 0) AS sessions_with_publication,
      count(*) FILTER (WHERE displayed > 0) AS sessions_with_display,
      count(*) FILTER (WHERE stop_reason IS NOT NULL) AS stopped_sessions,
      count(*) FILTER (WHERE stop_reason IN ('checkout_context_personalization', 'checkout_context_catalog',
        'checkout_context_crypto', 'checkout_context_offer', 'checkout_context_incentive', 'checkout_context_payment')) AS context_exits,
      COALESCE(sum(turns), 0) AS turns, COALESCE(sum(published), 0) AS publications,
      COALESCE(sum(displayed), 0) AS displays, COALESCE(sum(provider_failed), 0) AS provider_failed,
      COALESCE(sum(provider_unknown), 0) AS provider_unknown, COALESCE(sum(suppressed), 0) AS suppressed,
      COALESCE(sum(ai_priced), 0) AS ai_priced, COALESCE(sum(ai_not_dispatched), 0) AS ai_not_dispatched,
      COALESCE(sum(ai_cost), 0) AS ai_cost, COALESCE(sum(ai_held), 0) AS ai_held,
      COALESCE(string_agg(DISTINCT ai_currencies, ','), '') AS ai_currencies,
      COALESCE(sum(ai_overruns), 0) AS ai_overruns,
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

/** Exits are operational evidence, never an exclusion from the original arms. */
export function strategyParticipation(rows: Array<Record<string, bigint | number | string>>, plan: MeasurementPlan) {
  const arm = (id: string) => {
    const row = rows.find(r => r.variant === id);
    return { assigned: Number(row?.assigned ?? 0), stoppedSessions: Number(row?.stopped_sessions ?? 0),
      contextExitSessions: Number(row?.context_exits ?? 0) };
  };
  return { definition: "strategy-participation-v1", populationSource: "immutable_strategy_assignments",
    control: arm(plan.controlVariantId), treatment: arm(plan.treatmentVariantId) };
}

/** Native-currency estimates for this execution's pinned chat calls only. Never
 * add currencies or mistake a held reservation for a charge or unknown for zero. */
export function strategyAiUsage(rows: Array<Record<string, bigint | number | string>>, plan: MeasurementPlan) {
  const arm = (id: string) => {
    const row = rows.find(r => r.variant === id);
    const n = (key: string) => Number(row?.[key] ?? 0);
    const currencies = [...new Set(String(row?.ai_currencies ?? "").split(",").filter(Boolean))].sort();
    const monetary = (key: string) => currencies.length === 1 && Number.isSafeInteger(n(key)) && n(key) >= 0 ? n(key) : null;
    const admittedTurns = n("turns"), pricedTurns = n("ai_priced"), notDispatchedTurns = n("ai_not_dispatched");
    const unknownTurns = admittedTurns - pricedTurns - notDispatchedTurns;
    return { admittedTurns, pricedTurns, notDispatchedTurns, unknownTurns, currencies,
      currency: currencies.length === 1 ? currencies[0] : null,
      estimatedCostMicros: admittedTurns > 0 && unknownTurns === 0 ? monetary("ai_cost") : null,
      knownEstimatedCostMicros: pricedTurns > 0 ? monetary("ai_cost") : null,
      heldUpperBoundMicros: monetary("ai_held"), overrunTurns: n("ai_overruns") };
  };
  return { definition: "strategy-chat-ai-usage-v1", scope: "pinned_strategy_chat_calls", tariffBasis: "upper_bound_estimate",
    control: arm(plan.controlVariantId), treatment: arm(plan.treatmentVariantId) };
}

export function strategyCostCoverage(rows: Array<Record<string, bigint | number | string>>, plan: MeasurementPlan) {
  const arm = (id: string) => {
    const row = rows.find(r => r.variant === id);
    const orders = Number(row?.orders ?? 0), capturedOrders = Number(row?.cost_snapshots ?? 0), coveredOrders = Number(row?.priced_orders ?? 0);
    const known = Number(row?.catalog_cost ?? 0), safe = Number.isSafeInteger(known) && known >= 0;
    return { orders, capturedOrders, coveredOrders,
      configuredProductCostCents: orders > 0 && coveredOrders === orders && safe ? known : null,
      knownConfiguredProductCostCents: coveredOrders > 0 && safe ? known : null };
  };
  return { definition: "strategy-order-cost-coverage-v1", source: "catalog_at_order_recording",
    control: arm(plan.controlVariantId), treatment: arm(plan.treatmentVariantId) };
}

/** Confirmed allocation fees for mature, currently approved orders only. This
 * excludes failed/refunded payments and is not total strategy cost or profit.
 * Missing/incomplete observations never inherit planned amounts or become zero. */
export function strategyPaymentCosts(rows: Array<Record<string, bigint | number | string>>, plan: MeasurementPlan) {
  const arm = (id: string) => {
    const row = rows.find(r => r.variant === id);
    const n = (key: string) => Number(row?.[key] ?? 0);
    const orders = n("orders"), linkedOrders = n("linked_payments"), coveredOrders = n("confirmed_payments");
    const platform = n("platform_fees"), provider = n("provider_fees"), total = platform + provider;
    const safe = [platform, provider, total].every(value => Number.isSafeInteger(value) && value >= 0);
    const complete = orders > 0 && coveredOrders === orders && safe;
    return { orders, linkedOrders, coveredOrders,
      confirmedPlatformFeeCents: complete ? platform : null,
      confirmedProviderFeeCents: complete ? provider : null,
      confirmedPaymentFeesCents: complete ? total : null,
      knownConfirmedPaymentFeesCents: coveredOrders > 0 && safe ? total : null };
  };
  return { definition: "strategy-payment-cost-coverage-v1", currency: "BRL",
    scope: "mature_approved_orders", source: "latest_recorded_payment_settlement",
    control: arm(plan.controlVariantId), treatment: arm(plan.treatmentVariantId) };
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
