import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

export type ObservationSnapshot = {
  id: string;
  merchant_id: string;
  observation_window_start: string;
  observation_window_end: string;
  funnel: {
    total_sessions: number;
    started_checkout: number;
    reached_shipping: number;
    reached_payment: number;
    completed_order: number;
    conversion_rate: number;
  };
  abandonment: {
    abandoned_at_shipping: number;
    abandoned_at_payment: number;
    abandonment_rate: number;
    top_abandonment_objection: string;
  };
  objections: {
    shipping_cost_count: number;
    price_count: number;
    trust_count: number;
    payment_count: number;
    unknown_count: number;
  };
  cross_sell: {
    suggestions_shown: number;
    suggestions_accepted: number;
    acceptance_rate: number;
    top_suggested_skus: Array<{ sku: string; accepted_count: number }>;
  };
  current_experiment?: {
    experiment_id: string;
    control_conversion_rate: number;
    challenger_conversion_rate: number;
    sessions_per_variant: number;
  };
  cohorts: {
    returning_customers_rate: number;
    new_customers_rate: number;
    high_discount_sensitivity_rate: number;
    low_discount_sensitivity_rate: number;
  };
  revenue: {
    total_revenue_cents: number;
    avg_order_value_cents: number;
    total_orders: number;
  };
  ai_costs_cents: number;
  fingerprint: string;
  created_at: string;
};

export class ObservationEntity {
  private constructor(private _snapshot: ObservationSnapshot) {}

  static create(input: {
    merchant_id: string;
    observation_window_start: Date;
    observation_window_end: Date;
    funnel: ObservationSnapshot["funnel"];
    abandonment: ObservationSnapshot["abandonment"];
    objections: ObservationSnapshot["objections"];
    cross_sell: ObservationSnapshot["cross_sell"];
    current_experiment?: ObservationSnapshot["current_experiment"];
    cohorts: ObservationSnapshot["cohorts"];
    revenue: ObservationSnapshot["revenue"];
    ai_costs_cents: number;
  }): ObservationEntity {
    const id = randomUUID();
    const now = new Date().toISOString();

    const metricsHash = createHash("sha256")
      .update(
        JSON.stringify({
          funnel: input.funnel,
          abandonment: input.abandonment,
          objections: input.objections,
          cross_sell: input.cross_sell,
          revenue: input.revenue,
        })
      )
      .digest("hex");

    const fingerprint = createHash("sha256")
      .update(
        `${input.merchant_id}${input.observation_window_start.toISOString()}${metricsHash}`
      )
      .digest("hex");

    return new ObservationEntity({
      id,
      merchant_id: input.merchant_id,
      observation_window_start: input.observation_window_start.toISOString(),
      observation_window_end: input.observation_window_end.toISOString(),
      funnel: input.funnel,
      abandonment: input.abandonment,
      objections: input.objections,
      cross_sell: input.cross_sell,
      current_experiment: input.current_experiment,
      cohorts: input.cohorts,
      revenue: input.revenue,
      ai_costs_cents: input.ai_costs_cents,
      fingerprint,
      created_at: now,
    });
  }

  static rehydrate(snap: ObservationSnapshot): ObservationEntity {
    return new ObservationEntity(snap);
  }

  get id(): string { return this._snapshot.id; }
  get merchant_id(): string { return this._snapshot.merchant_id; }
  get fingerprint(): string { return this._snapshot.fingerprint; }
  get funnel() { return this._snapshot.funnel; }
  get abandonment() { return this._snapshot.abandonment; }
  get objections() { return this._snapshot.objections; }
  get cross_sell() { return this._snapshot.cross_sell; }
  get cohorts() { return this._snapshot.cohorts; }
  get revenue() { return this._snapshot.revenue; }

  snapshot(): ObservationSnapshot { return { ...this._snapshot }; }
}
