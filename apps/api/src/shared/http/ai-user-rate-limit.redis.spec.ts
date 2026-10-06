import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DistributedRateLimitStore } from "./rate-limit.store.js";
import { AiUserRateLimitService } from "./ai-user-rate-limit.service.js";

test("two replicas share ten admissions in real Redis without spending the global allowance", {
  skip: !process.env.AI_RATE_LIMIT_TEST_REDIS_URL,
}, async () => {
  const options = { production: true, redisUrl: process.env.AI_RATE_LIMIT_TEST_REDIS_URL, ipMax: 600, tenantMax: 60, windowMs: 60_000 };
  const stores = [new DistributedRateLimitStore(options), new DistributedRateLimitStore(options)];
  const limiters = stores.map(store => new AiUserRateLimitService(store));
  const user = `buyer:${randomUUID()}`, globalKey = `ip:test:${randomUUID()}`;
  try {
    assert.equal((await stores[0].hit(globalKey, 600, 60_000)).remaining, 599);
    const results = await Promise.all(Array.from({ length: 100 }, (_, index) => limiters[index % 2].consume(user)));
    assert.equal(results.filter(result => result.allowed).length, 10);
    assert.ok(results.every(result => result.retryAfterMs > 0 && result.retryAfterMs <= 60_000));
    assert.equal((await limiters[1].consume(`buyer:${randomUUID()}`)).remaining, 9);
    assert.equal((await stores[1].hit(globalKey, 600, 60_000)).remaining, 598);
  } finally { stores.forEach(store => store.onModuleDestroy()); }
});
