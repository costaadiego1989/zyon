import { expect, test } from "@playwright/test";
import { readStorefrontView, productShareUrl, storefrontViewUrl } from "../src/lib/storefront-navigation";
test("URL helpers retain campaigns and remove checkout credentials from product sharing", () => {
  const url = storefrontViewUrl("https://store.example/store/test?utm_source=email&show=checkout&recovery=secret&embedToken=private", { checkout: false, cart: false, productId: "product-one" });
  expect(url).toBe("/store/test?utm_source=email&show=content&product=product-one");
  expect(productShareUrl("https://store.example", "test", "product-one")).toBe("https://store.example/store/test?show=content&product=product-one");
  expect(readStorefrontView("?show=product&productId=product-one").productId).toBe("product-one");
  expect(readStorefrontView("?show=content&product=../secret").productId).toBeUndefined();
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("zyon-theme", "light"); });
  // Every API request is served by local fixtures. External pixels and services are blocked.
  await page.route(/^https?:\/\/(?!localhost:4318|127\.0\.0\.1:4319)/, route => route.abort());
});
test("opening, copying, refreshing and browser back/forward retain the selected product", async ({ page, context }) => {
  await page.goto("/store/test-store");
  await page.waitForFunction(() => document.querySelector("#storefront-chat"));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aacp:open-product-content", { detail: { productId: "product-one" } })));
  await expect(page).toHaveURL(/show=content&product=product-one/);
  await expect(page.locator("[data-aacp-product-content]")).toBeVisible();
  await page.getByRole("button", { name: "Copiar link do produto", exact: true }).first().click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe("http://localhost:4318/store/test-store?show=content&product=product-one");
  await page.goBack();
  await expect(page.locator("[data-aacp-rich-product-experience]")).toHaveCount(0);
  await page.goForward();
  await expect(page.locator("[data-aacp-product-content]")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-aacp-product-content]")).toBeVisible();
  const fresh = await context.newPage();
  await fresh.goto(copied);
  await expect(fresh.locator("[data-aacp-product-content]")).toBeVisible();
  await fresh.close();
  await page.getByRole("button", { name: "Voltar ao chat", exact: true }).click();
  await expect(page).not.toHaveURL(/product=/);
});
test("direct cart and checkout URLs load and can return to the store", async ({ page }) => {
  await page.goto("/store/test-store?show=cart");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goto("/store/test-store?show=checkout");
  await expect(page.getByText("Seu carrinho está vazio neste navegador.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(page).not.toHaveURL(/show=checkout/);
});
test("recovery in a fresh browser asks for the original buyer and expired links offer a way back", async ({ page }, testInfo) => {
  await page.goto("/store/test-store?show=checkout&recovery=valid");
  await expect(page.getByRole("heading", { name: "Continue sua compra" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect.poll(() => page.locator("[data-aacp-recovery]").evaluate(panel => panel.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("recovery-login.png"), fullPage: true });
  await page.goto("/store/test-store?show=checkout&recovery=expired");
  await expect(page.locator("[data-aacp-recovery]").getByRole("alert")).toContainText("Este link expirou");
  await page.getByRole("button", { name: "Voltar à loja", exact: true }).click();
  await expect(page).not.toHaveURL(/recovery=/);
});
test("authenticated recovery starts the original checkout without a tab cart or conversation token", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("zyon_buyer_token", "header." + btoa(JSON.stringify({ sub: "buyer-local", exp: Math.floor(Date.now() / 1000) + 3600 })) + ".fixture"));
  const starts: any[] = [];
  page.on("request", request => { if (request.url().endsWith("/embed/start")) starts.push(request.postDataJSON()); });
  await page.goto("/store/test-store?show=checkout&recovery=valid");
  await expect.poll(() => starts.length).toBeGreaterThan(0);
  expect(starts[0].cart_ref).toBeUndefined();
  expect(starts[0].buyer_access_token).toBeTruthy();
  await expect(page.getByText("Revise sua compra recuperada").first()).toBeVisible();
  await expect(page.getByText("Checkout indisponível", { exact: true })).toHaveCount(0);
});
