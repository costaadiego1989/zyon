import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  // Public API reads only; conversation/cart/quote requests use the real Next proxy.
  await page.route("http://localhost:3009/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ budgetModeEnabled: true, mode: "manual_only", enabledTriggers: [], suppressedSteps: [], blockedRegions: [] }) }));
});

test("full storefront preserves merchant theme after hydration and centers each configured width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [mode, density, width, background] of [
    ["dark", "compact", "480px", "rgb(25, 31, 29)"],
    ["grey", "comfortable", "680px", "rgb(36, 39, 38)"],
    ["light", "spacious", "1440px", "rgb(247, 248, 250)"],
  ]) {
    await page.goto(`/store/${mode}-${density}`);
    await expect(page.getByRole("button", { name: /Por chat/ })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-neu-theme", mode === "light" ? "light" : "dark");
    const shell = page.locator(".storefront-shell");
    await expect(shell).toHaveCSS("width", width);
    await expect(shell).toHaveCSS("background-color", background);
    await expect(page.locator("#storefront-chat")).toHaveCSS("border-radius", "24px");
    expect(await shell.evaluate((el) => Math.round(el.getBoundingClientRect().left))).toBe((1440 - parseInt(width)) / 2);
  }
  expect(errors).toEqual([]);
});

test("full storefront opens quote from chat and submits through the real Next proxy", async ({ page, request }, info) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.addInitScript(() => {
    sessionStorage.setItem("zyon-cart-id:merchant", "conversation");
    sessionStorage.setItem("aacp_conversation_access:conversation", btoa(JSON.stringify({ expiresAt: Date.now() / 1000 + 3600, origin: location.origin })) + ".test-signature");
    sessionStorage.setItem("zyon_conversation_state_merchant", JSON.stringify({ conversationId: "conversation", messages: [], mode: "intro", channel: null, savedAt: Date.now() }));
  });
  await page.goto("/store/grey-compact");
  await page.getByRole("button", { name: /Por chat/ }).click();
  const dialog = page.getByRole("dialog", { name: "Carrinho" });
  if (!(await dialog.isVisible())) await page.getByRole("button", { name: "Solicitar orçamento", exact: true }).first().click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalizar pedido", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Solicitar orçamento", exact: true }).click();
  await page.getByLabel("Nome completo").fill("Comprador de teste");
  await page.getByLabel("Email", { exact: true }).fill("buyer@example.test");
  await page.getByLabel("WhatsApp", { exact: true }).fill("11999999999");
  await page.getByRole("button", { name: "Enviar solicitação", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Orçamento enviado!");
  const received = await (await request.get("http://127.0.0.1:5201/requests")).json();
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({ customer_name: "Comprador de teste", merchant_id: "merchant", cart_id: "conversation", authorized: true, internal: true });
  expect(received[0].items).toBeUndefined();
  await page.screenshot({ path: info.outputPath("storefront-quote-success.png") });
});
