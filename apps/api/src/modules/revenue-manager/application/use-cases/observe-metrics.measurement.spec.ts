import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { ObserveMetricsUseCase } from "./observe-metrics.use-case.js";
import type { ObservationEntity } from "../../domain/entities/observation.entity.js";
import type { ObservationRepositoryPort } from "../../domain/ports/observation-repository.port.js";

function fixture(events: Array<{ eventName: string; _count: number }>) {
  let saved: ObservationEntity | undefined;
  const prisma = {
    checkoutSession: {
      count: async () => 100,
      findMany: async () => []
    },
    completedOrder: {
      count: async () => 20,
      aggregate: async () => ({ _sum: { orderTotal: 2000 }, _count: 20, _avg: { orderTotal: 100 } })
    },
    checkoutEvent: { groupBy: async () => events },
    promptExperiment: { findFirst: async () => null },
    negotiationCostLedgerEntry: { aggregate: async () => ({ _sum: { aiCostCents: 25 } }) }
  } as unknown as PrismaClient;
  const repository: ObservationRepositoryPort = {
    save: async (observation) => { saved = observation; },
    findById: async () => null,
    findByFingerprint: async () => null,
    findLatestByMerchant: async () => null,
    findByMerchant: async () => []
  };
  return {
    execute: () => new ObserveMetricsUseCase(prisma, repository).execute({
      merchant_id: "mrc_1",
      window_start: new Date("2026-09-01T00:00:00.000Z"),
      window_end: new Date("2026-09-02T00:00:00.000Z")
    }),
    saved: () => saved
  };
}

test("ObserveMetricsUseCase marks an eventless window insufficient instead of fabricating funnel metrics", async () => {
  const h = fixture([]);
  const result = await h.execute();
  const observation = h.saved()?.snapshot();

  assert.equal(result.data_ready, false);
  assert.deepEqual(result.missing_metrics, ["checkout_events", "checkout_started_event"]);
  assert.equal(result.conversion_rate, null);
  assert.equal(observation?.funnel.reached_shipping, 0);
  assert.equal(observation?.funnel.reached_payment, 0);
  assert.equal(observation?.funnel.conversion_rate, null);
  assert.equal(observation?.data_quality.status, "insufficient_data");
  assert.equal(observation?.data_quality.sources.checkout_events, "unavailable");
});

test("ObserveMetricsUseCase uses emitted checkout event names and real conversion when the sample is measured", async () => {
  const h = fixture([
    { eventName: "checkout_started", _count: 100 },
    { eventName: "shipping_option_selected", _count: 65 },
    { eventName: "payment_method_selected", _count: 40 },
    { eventName: "shipping_objection_detected", _count: 12 },
    { eventName: "payment_failed", _count: 4 }
  ]);
  const result = await h.execute();
  const observation = h.saved()?.snapshot();

  assert.equal(result.data_ready, true);
  assert.deepEqual(result.missing_metrics, []);
  assert.equal(result.conversion_rate, 0.2);
  assert.equal(observation?.funnel.reached_shipping, 65);
  assert.equal(observation?.funnel.reached_payment, 40);
  assert.equal(observation?.abandonment.abandoned_at_shipping, 12);
  assert.equal(observation?.abandonment.abandoned_at_payment, 4);
  assert.equal(observation?.data_quality.status, "ready");
  assert.equal(observation?.cohorts.high_discount_sensitivity_rate, null);
});
