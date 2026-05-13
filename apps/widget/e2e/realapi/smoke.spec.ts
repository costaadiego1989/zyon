/**
 * @realapi smoke — API seed endpoint reachable and returns expected shape.
 * Gate for T040: widget-realapi project wired correctly.
 */
import { test, expect } from "@playwright/test";

test("@realapi smoke: seed endpoint returns expected shape", async ({ request }) => {
  const res = await request.post("http://localhost:3000/__test__/seed");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body).toHaveProperty("merchantId");
  expect(body).toHaveProperty("embedToken");
  expect(body).toHaveProperty("productId");
  expect(body.merchantId).toMatch(/^e2e_/);
});
