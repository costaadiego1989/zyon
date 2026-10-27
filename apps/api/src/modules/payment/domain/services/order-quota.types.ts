import type { BillingPlan } from "../payment-platform.types.js";
import type { OrderQuotaState } from "./order-quota.policy.js";

export type OrderQuotaPeriod = {
  start: Date;
  end: Date;
};

export type OrderQuotaEpisode = {
  id: string;
  merchantId: string;
  periodStart: Date;
  planKey: string;
  limitAtStart: number;
  graceExpiresAt: Date;
  blockedAt: Date | null;
  resolvedAt: Date | null;
};

export type OrderQuotaSnapshot = {
  merchantId: string;
  plan: BillingPlan;
  limit: number | null;
  usedOrders: number;
  periodStart: string;
  periodEnd: string;
  state: OrderQuotaState;
  graceExpiresAt?: string;
  blockedAt?: string;
  requiredPlan?: BillingPlan;
  canAcceptOrders: boolean;
};

export type OrderQuotaNoticeContext = {
  merchantId: string;
  plan: BillingPlan;
  limit: number;
  usedOrders: number;
  period: OrderQuotaPeriod;
  state: OrderQuotaState;
  episode: OrderQuotaEpisode;
};
