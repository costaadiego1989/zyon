import { test, expect, type Page } from "@playwright/test";

const WIDGET_URL = "http://127.0.0.1:5174";

const availableExperience = {
  session_id: "commercial-guard-session",
  experience: {
    brand: { name: "Test Store", mode: "dark" },
    agent: { name: "IA" },
    items: [{ sku: "P1", name: "Produto", unit_price: 99.9, quantity: 1 }],
    totals: { subtotal: 99.9, discount: 0, total: 99.9 },
    rules: { showBranding: false },
  },
};

async function navigateEmbed(page: Page) {
  await page.goto(WIDGET_URL + "/?embed=1&embedToken=tok&merchantId=mrc&apiBaseUrl=" + WIDGET_URL, { waitUntil: "domcontentloaded" });
}

async function configureAvailableCheckout(page: Page) {
  await page.route("**/embed/start", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(availableExperience) }));
  await page.route("**/checkout-settings/widget-config**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabledTriggers: [], advancedRules: [] }) }));
  await page.route("**/embed/track", (route) => route.fulfill({ status: 200, body: "{}" }));
}

test("embedded checkout hides merchant commercial status when sales are suspended", async ({ page }) => {
  await page.route("**/embed/start", (route) => route.fulfill({
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({ code: "merchant_sales_suspended" }),
  }));

  await navigateEmbed(page);

  await expect(page.getByRole("heading", { name: "Loja temporariamente indisponível" })).toBeVisible();
  await expect(page.getByText("Esta loja está temporariamente indisponível para novos pedidos. Tente novamente mais tarde.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Mensagem" })).toHaveCount(0);
});

test("embedded checkout tells the buyer when this conversation must wait", async ({ page }) => {
  await configureAvailableCheckout(page);
  await page.route("**/embed/chat", (route) => route.fulfill({
    status: 429,
    contentType: "application/json",
    body: JSON.stringify({ code: "ai_interaction_rate_limited", retry_after_seconds: 23 }),
  }));

  await navigateEmbed(page);
  await page.getByRole("button", { name: "Por chat" }).click();
  const composer = page.locator('input[aria-label="Mensagem"]');
  await composer.fill("Olá");
  await composer.press("Enter");

  await expect(page.getByText("Recebi muitas mensagens nesta conversa. Aguarde 23 segundos e envie novamente.")).toBeVisible();
  await expect(composer).toBeVisible();
});
