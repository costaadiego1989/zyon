import { expect, test } from "vitest";
import { catalogEndpoints } from "./catalog.js";

test("lists simple promotions through the merchant and product scoped endpoint", async () => {
  const requests: Array<{ url: string; method?: string }> = [];
  const promotion = {
    id: "promotion-a",
    productId: "product/a",
    discountType: "percent" as const,
    discountValue: 15,
    isActive: true,
    startsAt: "2026-09-01T00:00:00.000Z",
    endsAt: "2026-10-01T00:00:00.000Z",
  };
  const api = catalogEndpoints(
    "https://api.example.test",
    (async (input, init) => {
      requests.push({ url: String(input), method: init?.method });
      return new Response(JSON.stringify({ promotions: [promotion] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  );

  await expect(api.listProductPromotions("merchant/a", "product/a")).resolves.toEqual({ promotions: [promotion] });
  expect(requests).toEqual([{
    url: "https://api.example.test/v1/merchants/merchant%2Fa/products/product%2Fa/promotion",
    method: "GET",
  }]);
});
