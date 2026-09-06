import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryDomainEventBus } from "../../../../shared/events/in-memory-domain-event-bus.js";
import { StrategyFeedbackWorker } from "./strategy-feedback.worker.js";

test("experiment completion uses the shared bus, scopes hypothesis ownership and propagates a failed effect", async () => {
  const bus = new InMemoryDomainEventBus();
  const queries: unknown[] = [];
  const effects: unknown[] = [];
  let fail = true;
  const prisma = { revenueManagerHypothesis: { async findFirst(query: { where: { merchantId: string } }) {
    queries.push(query);
    return query.where.merchantId === "merchant-a" ? { id: "hypothesis-a" } : null;
  } } };
  const effect = { async execute(input: unknown) {
    effects.push(input);
    if (fail) throw new Error("database_unavailable");
  } };
  const worker = new StrategyFeedbackWorker(bus, effect as never, prisma as never);
  worker.onModuleInit();
  const event = { eventType: "experiment.completed", merchantId: "merchant-a", payload: { experiment_id: "exp-a" } };
  await assert.rejects(bus.publish(event), /database_unavailable/);
  fail = false;
  await bus.publish(event);
  await bus.publish({ ...event, merchantId: "merchant-b" });
  assert.equal(effects.length, 2);
  assert.deepEqual(effects[1], { merchant_id: "merchant-a", experiment_id: "exp-a", hypothesis_id: "hypothesis-a" });
  assert.deepEqual(queries[0], { where: { merchantId: "merchant-a", createdExperimentId: "exp-a" }, select: { id: true } });
  assert.equal(bus.handlersFor(event.eventType)[0].handlerId, "revenue-manager.StrategyFeedbackWorker");
});

test("invalid experiment completion fails before querying or acknowledging delivery", async () => {
  const bus = new InMemoryDomainEventBus();
  const worker = new StrategyFeedbackWorker(bus, {} as never, {} as never);
  worker.onModuleInit();
  for (const payload of [null, {}, { experiment_id: " " }, { experiment_id: 1 }]) {
    await assert.rejects(bus.publish({ eventType: "experiment.completed", merchantId: "m", payload }), /experiment_completion_scope_invalid/);
  }
});
