/**
 * T045 — Cross-tenant embed isolation via real API.
 *
 * Seeds two separate merchants. Verifies that merchant A's embed token
 * cannot bootstrap a session under merchant B's context.
 */
import { test, expect } from "@playwright/test";
import { REALAPI_URL } from "../fixtures/realapi-helpers.js";

const API = REALAPI_URL;

test.describe("@realapi cross-tenant embed isolation", () => {
  test("embed token from merchant A rejected for merchant B", async ({ request }) => {
    const seedA = await request.post(`${API}/__test__/seed`);
    expect(seedA.ok()).toBe(true);
    const { embedToken: embedTokenA } = await seedA.json();

    const seedB = await request.post(`${API}/__test__/seed`);
    expect(seedB.ok()).toBe(true);
    const { embedToken: embedTokenB } = await seedB.json();

    // Merchant B starts a real checkout session under its own token.
    const startedB = await request.post(`${API}/embed/start`, {
      headers: {
        "x-aacp-embed-token": embedTokenB,
        "Origin": "http://127.0.0.1:5173"
      },
      data: {
        customer: {},
        cart: {
          currency: "BRL",
          source: "storefront",
          total: 150,
          items: [{ sku: "e2e_product_001", name: "Produto E2E", price: 150, quantity: 1 }],
        },
      },
    });
    expect(startedB.ok()).toBe(true, `Start B failed: ${await startedB.text()}`);
    const { session_id: sessionIdB } = await startedB.json();

    // Merchant A's token attempts to operate on merchant B's session.
    const res = await request.post(`${API}/embed/coupons/apply`, {
      headers: {
        "x-aacp-embed-token": embedTokenA,
        "Origin": "http://127.0.0.1:5173"
      },
      data: {
        session_id: sessionIdB,
        code: "TESTE10",
        cart: {
          currency: "BRL",
          source: "storefront",
          total: 150,
          items: [{ sku: "e2e_product_001", name: "Produto E2E", price: 150, quantity: 1 }],
        },
      },
    });

    // Cross-tenant access must be rejected (403 forbidden or 404 not found
    // — B's session is not visible to A's merchant scope).
    expect([401, 403, 404]).toContain(res.status());
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
