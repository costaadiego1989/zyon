/**
 * T045 — Cross-tenant embed isolation via real API.
 *
 * Seeds two separate merchants. Verifies that merchant A's embed token
 * cannot bootstrap a session under merchant B's context.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:3000";

test.describe("@realapi cross-tenant embed isolation", () => {
  test("embed token from merchant A rejected for merchant B", async ({ request }) => {
    const seedA = await request.post(`${API}/__test__/seed`);
    expect(seedA.ok()).toBe(true);
    const { merchantId: merchantIdA, embedToken: embedTokenA } = await seedA.json();

    const seedB = await request.post(`${API}/__test__/seed`);
    expect(seedB.ok()).toBe(true);
    const { merchantId: merchantIdB } = await seedB.json();

    // Attempt to start checkout using merchant A's token but merchant B's merchant ID
    const res = await request.post(`${API}/embed/checkout`, {
      data: {
        merchantId: merchantIdB,
        productId: "e2e_product_001",
        quantity: 1,
      },
      headers: {
        Authorization: `Bearer ${embedTokenA}`,
        "x-merchant-id": merchantIdB,
      },
    });

    // Must be rejected — 401 or 403
    expect([401, 403]).toContain(res.status());
  });

  test("each seed produces a unique merchant ID", async ({ request }) => {
    const [a, b] = await Promise.all([
      request.post(`${API}/__test__/seed`).then((r) => r.json()),
      request.post(`${API}/__test__/seed`).then((r) => r.json()),
    ]);
    expect(a.merchantId).not.toBe(b.merchantId);
    expect(a.embedToken).not.toBe(b.embedToken);
  });
});
