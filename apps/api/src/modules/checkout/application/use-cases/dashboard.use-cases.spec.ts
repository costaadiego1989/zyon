import assert from "node:assert/strict";
import test from "node:test";
import { GetDashboardOverviewUseCase } from "./dashboard.use-cases.js";

test("checkout overview forwards the dashboard period to its read model", async () => {
  let receivedPeriod: string | undefined;
  const readModel = {
    overview: async (_merchantId: string, period: string) => {
      receivedPeriod = period;
      return {
        merchant_id: "merchant_1",
        conversations_started: 0,
        offers_viewed: 0,
        offers_accepted: 0,
        orders_completed: 0,
        conversion_rate_with_agent: 0,
        average_discount: 0,
        average_shipping_subsidy: 0,
        incremental_revenue: 0,
        recent_sessions: [],
        recent_offers: [],
      };
    },
  };

  await new GetDashboardOverviewUseCase(readModel as any).execute("merchant_1", "30d");

  assert.equal(receivedPeriod, "30d");
});
