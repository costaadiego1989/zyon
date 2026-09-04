import { test, expect } from "@playwright/test";
import { buildExperience, startCheckoutResponse } from "./fixtures/api-mocks.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

const CART = {
  currency: "BRL" as const,
  source: "storefront" as const,
  total: 129.9,
  items: [
    {
      sku: "ZYON-SHIRT-001",
      name: "Camiseta Zyon Dev",
      price: 129.9,
      cost: 62,
      quantity: 1,
      category: "vestuario",
      variant: "preta",
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as any).process = { env: { AACP_DISABLE_STREAMING: "1" } };
  });
});

test("renders cross-sell combo title and price from /embed/start suggestedProducts", async ({ page }) => {
  await page.route("**/embed/start", async (route) => {
    const body = route.request().postDataJSON() as { cart?: { items?: Array<{ sku?: string }> } };
    const hasTriggerSku = body.cart?.items?.some((item) => item.sku === "ZYON-SHIRT-001") === true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(startCheckoutResponse(buildExperience({
        items: [
          {
            sku: "ZYON-SHIRT-001",
            name: "Camiseta Zyon Dev",
            quantity: 1,
            unit_price: 129.9,
            line_total: 129.9,
            image_url: "https://cdn.example.com/zyon-shirt.png",
            product_url: "https://shop.example.com/zyon-shirt",
            category: "vestuario",
            variant: "preta",
          },
        ],
        totals: { currency: "BRL", subtotal: 129.9, shipping: 0, discount: 0, total: 129.9 },
        suggestedProducts: hasTriggerSku
          ? [{ suggestion_id: "sug_zyon", sku: "ZYON-HOOD-001", name: "Hoodie Agentic Checkout", unit_price: 199.9 }]
          : [],
      }))),
    });
  });
  await page.route("**/embed/coupons/apply", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ discount_applied: 0 }),
    });
  });

  await page.goto(BASE);
  await page.evaluate((cart) => {
    document.documentElement.style.background = "#fff";
    document.body.innerHTML = "";
    const el = document.createElement("zyon-checkout-agent");
    el.setAttribute("merchant-id", "mrc_zyon");
    el.setAttribute("embed-session-token", "tok_e2e_cross_sell");
    el.setAttribute("api-base-url", "http://localhost:3009");
    el.setAttribute("ui-presentation", "floating");
    el.setAttribute("cart-json", JSON.stringify(cart));
    document.body.appendChild(el);
  }, CART);
  await page.getByRole("button", { name: /Por chat/i }).click();
  await page.getByRole("button", { name: /^Continuar$/i }).click();

  const combo = page.locator("text=Costuma ser adicionado junto").locator("..");
  await expect(combo).toContainText("Hoodie Agentic Checkout", { timeout: 10_000 });
  await expect(combo).toContainText("R$", { timeout: 10_000 });
  await expect(combo).toContainText("199,90", { timeout: 10_000 });
});
