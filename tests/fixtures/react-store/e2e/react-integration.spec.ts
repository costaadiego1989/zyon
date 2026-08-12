import { test, expect } from "@playwright/test";

const BASE = "http://127.0.0.1:5180";

test.describe("React Integration @react", () => {
  test("renders product page with 4 products", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator("h2")).toHaveText("Produtos");
    await expect(page.locator("[data-testid^='add-']")).toHaveCount(4);
  });

  test("add product to cart updates badge", async ({ page }) => {
    await page.goto(BASE);
    await page.click("[data-testid='add-SHIRT-001']");
    await expect(page.locator("button:has-text('Carrinho (1)')")).toBeVisible();
  });

  test("cart page shows items and total", async ({ page }) => {
    await page.goto(BASE);
    await page.click("[data-testid='add-SHIRT-001']");
    await page.click("[data-testid='add-PANTS-001']");
    await page.click("button:has-text('Carrinho (2)')");
    await expect(page.locator("text=Camiseta Premium")).toBeVisible();
    await expect(page.locator("text=Calça Jeans Slim")).toBeVisible();
    await expect(page.locator("text=R$ 449,80")).toBeVisible();
  });

  test("remove item from cart", async ({ page }) => {
    await page.goto(BASE);
    await page.click("[data-testid='add-SHIRT-001']");
    await page.click("button:has-text('Carrinho (1)')");
    await page.click("[data-testid='remove-SHIRT-001']");
    await expect(page.locator("text=Seu carrinho está vazio")).toBeVisible();
  });

  test("checkout page mounts zyon-checkout-agent element", async ({ page }) => {
    await page.goto(BASE);
    await page.click("[data-testid='add-SHIRT-001']");
    await page.click("button:has-text('Carrinho (1)')");
    await page.click("[data-testid='go-checkout']");
    await expect(page.locator("[data-testid='zyon-widget-container']")).toBeVisible();
    const widget = page.locator("zyon-checkout-agent");
    await expect(widget).toHaveCount(1);
    await expect(widget).toHaveAttribute("merchant-id", "mrc_react_test");
    await expect(widget).toHaveAttribute("api-base-url", "http://localhost:3009");
  });

  test("widget receives cart-json with correct items", async ({ page }) => {
    await page.goto(BASE);
    await page.click("[data-testid='add-SHIRT-001']");
    await page.click("[data-testid='add-SHOE-001']");
    await page.click("button:has-text('Carrinho (2)')");
    await page.click("[data-testid='go-checkout']");
    const widget = page.locator("zyon-checkout-agent");
    const cartJson = await widget.getAttribute("cart-json");
    const cart = JSON.parse(cartJson!);
    expect(cart.items).toHaveLength(2);
    expect(cart.items[0].sku).toBe("SHIRT-001");
    expect(cart.items[1].sku).toBe("SHOE-001");
    expect(cart.total).toBeCloseTo(549.8, 1);
  });

  test("SPA navigation does not duplicate widget", async ({ page }) => {
    await page.goto(BASE);
    await page.click("[data-testid='add-SHIRT-001']");
    await page.click("button:has-text('Carrinho (1)')");
    await page.click("[data-testid='go-checkout']");
    await expect(page.locator("zyon-checkout-agent")).toHaveCount(1);
    await page.click("button:has-text('Produtos')");
    await page.click("button:has-text('Carrinho (1)')");
    await page.click("[data-testid='go-checkout']");
    await expect(page.locator("zyon-checkout-agent")).toHaveCount(1);
  });

  test("checkout button disabled when cart empty", async ({ page }) => {
    await page.goto(BASE);
    const btn = page.locator("button:has-text('Checkout')");
    await expect(btn).toBeDisabled();
  });

  test("no console errors on product page", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    await page.goto(BASE);
    await page.waitForTimeout(1000);
    expect(errors).toHaveLength(0);
  });
});
