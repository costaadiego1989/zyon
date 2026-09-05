import test from "node:test";
import assert from "node:assert/strict";
import { firstValueFrom, of } from "rxjs";
import { ResponseEnvelopeInterceptor } from "./response-envelope.interceptor.js";

test("response envelope preserves arrays used by the billing catalog", async () => {
  const plans = [{ plan_id: "starter" }, { plan_id: "growth" }];
  const context = { switchToHttp: () => ({ getRequest: () => ({ correlationId: "test" }) }) };
  const output = await firstValueFrom(new ResponseEnvelopeInterceptor().intercept(context as any, { handle: () => of(plans) }));
  assert.deepEqual(output.data, plans);
  assert.equal(output.meta.request_id, "test");
});

test("response envelope preserves pagination and existing envelopes", async () => {
  const context = { switchToHttp: () => ({ getRequest: () => ({}) }) };
  const interceptor = new ResponseEnvelopeInterceptor();
  const result = await firstValueFrom(interceptor.intercept(context as any, { handle: () => of({ items: [1], pagination: { has_more: false } }) }));
  assert.deepEqual(result.data, { items: [1] });
  assert.equal(result.pagination.has_more, false);
  assert.deepEqual(await firstValueFrom(interceptor.intercept(context as any, { handle: () => of(result) })), result);
});
