export type IncentiveMetricArm = {
  assigned: number; mature: number; converted: number; orders: number; revenueCents: number; discountCents: number;
  redemptions: number; pendingReservations: number; released: number; refunds: number; refundedDiscountCents: number;
};
export type IncentiveMetrics = {
  strategyId: string; version: number; proposalHash: string;
  execution: null | { id: string; startedAt: string; endsAt: string; stoppedAt: string | null };
  measurement: null | {
    definition: "incentive-assigned-buyer-results-v1"; collectedAt: string; state: string; matureAt: string | null;
    unit: "assigned_buyer"; minimumBuyersPerArm: number; control: IncentiveMetricArm; treatment: IncentiveMetricArm;
    interval: null | { effectBps: number; lowerBps: number; upperBps: number };
    budget: { limitCents: number; reservedCents: number; spentCents: number; availableCents: number };
    economics: "confirmed_discount_only_not_profit"; promotionAllowed: false;
  };
};
