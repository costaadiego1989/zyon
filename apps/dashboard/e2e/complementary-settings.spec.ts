import { test, expect } from "@playwright/test";
import { DEFAULT_CROSS_SELL_CONFIG } from "@zyon/shared-types";

test("multiple locations share one source, persist and reload", async ({ page }) => {
  let config = { ...structuredClone(DEFAULT_CROSS_SELL_CONFIG), enabled: true, strategies: ["same_category", "ai_personalized"], touchpoints: { browsing: false, pre_cart: true, post_cart: false, pre_payment: false, post_purchase: true } };
  const writes: any[] = [];
  await page.route("**/merchants/me/cross-sell-config", async route => {
    if (route.request().method() === "PUT") { config = route.request().postDataJSON(); writes.push(config); }
    await route.fulfill({ json: config });
  });
  await page.goto("/e2e/fixtures/complementary-settings.html?surface=store");
  const before = page.getByRole("checkbox", { name: "Nos produtos" });
  const after = page.getByRole("checkbox", { name: "Antes de ir para o checkout" });
  await expect(before).toBeChecked();
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(1);
  await after.locator("..").click();
  await page.getByRole("checkbox", { name: "No checkout", exact: true }).locator("..").click();
  await page.getByRole("radio", { name: "Itens que se complementam" }).locator("..").click();
  await page.getByRole("radio", { name: "Comprados juntos" }).locator("..").click();
  await page.getByRole("radio", { name: "Comprados juntos" }).locator("..").click();
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(1);
  await expect(before).toBeChecked(); await expect(after).toBeChecked();
  await page.getByRole("button", { name: "Salvar sugestões" }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].strategies).toEqual(["bought_together"]);
  expect(writes[0].touchpoints).toMatchObject({ pre_cart: true, pre_checkout: true, pre_payment: true, post_purchase: true });
  await page.reload();
  await expect(page.getByRole("radio", { name: "Comprados juntos" })).toBeChecked();
  await expect(before).toBeChecked(); await expect(after).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `../../.audit/complementary-settings-20261007/products-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("radiogroup").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `../../.audit/complementary-settings-20261007/source-${test.info().project.name}.png` });
  const source = page.getByRole("radio", { name: "Comprados juntos" });
  await source.focus(); await source.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "Opções de maior valor" })).toBeChecked();
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(1);
});

test("enabled suggestions require a location and a source", async ({ page }) => {
  let writes = 0;
  await page.route("**/merchants/me/cross-sell-config", async route => {
    if (route.request().method() === "PUT") writes++;
    await route.fulfill({ json: { ...DEFAULT_CROSS_SELL_CONFIG, enabled: true, strategies: [], touchpoints: { browsing: true, pre_cart: false, pre_checkout: false, post_cart: true, pre_payment: false, post_purchase: true } } });
  });
  await page.goto("/e2e/fixtures/complementary-settings.html?surface=store");
  await page.getByRole("spinbutton", { name: "Máximo de sugestões por sessão" }).fill("3");
  await page.getByRole("button", { name: "Salvar sugestões" }).click();
  await expect(page.getByText("Escolha pelo menos um momento para sugerir produtos.")).toBeVisible();
  await expect(page.getByText("Escolha uma única estratégia para orientar as recomendações.")).toBeVisible();
  expect(writes).toBe(0);
});

test("checkout keeps multiple locations and the same single source", async ({ page }) => {
  const writes: any[] = [];
  await page.route("**/merchants/me/cross-sell-config", async route => {
    const config = { ...DEFAULT_CROSS_SELL_CONFIG, enabled: true, strategies: ["complementary"], touchpoints: { ...DEFAULT_CROSS_SELL_CONFIG.touchpoints, pre_cart: true, post_cart: true } };
    if (route.request().method() === "PUT") writes.push(route.request().postDataJSON());
    await route.fulfill({ json: route.request().method() === "PUT" ? writes.at(-1) : config });
  });
  await page.goto("/e2e/fixtures/complementary-settings.html?surface=checkout");
  await page.getByRole("checkbox", { name: "Antes de ir para o checkout" }).locator("..").click();
  await page.getByRole("radio", { name: "Sugestões personalizadas por IA" }).locator("..").click();
  await page.getByRole("button", { name: "Salvar sugestões" }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].strategies).toEqual(["ai_personalized"]);
  expect(writes[0].touchpoints).toMatchObject({ pre_cart: true, post_cart: true, pre_checkout: true, pre_payment: true });
});

test("support starts on Hoje with local-day boundaries and Todos remains available", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-07T15:00:00-03:00") });
  const tickets = [
    { id: "today-midnight", buyerMessage: "Mensagem de hoje", createdAt: "2026-10-07T03:00:00Z", status: "open" },
    { id: "yesterday-end", buyerMessage: "Mensagem de ontem", createdAt: "2026-10-07T02:59:59Z", status: "open" },
    { id: "tomorrow-start", buyerMessage: "Mensagem de amanhã", createdAt: "2026-10-08T03:00:00Z", status: "open" },
  ];
  await page.route("**/support/tickets", route => route.fulfill({ json: tickets }));
  await page.goto("/e2e/fixtures/complementary-settings.html?surface=support");
  await expect(page.getByRole("button", { name: "Hoje", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Mensagem de hoje")).toBeVisible();
  await expect(page.getByText("Mensagem de ontem")).toHaveCount(0);
  await expect(page.getByText("Mensagem de amanhã")).toHaveCount(0);
  await page.screenshot({ path: `../../.audit/complementary-settings-20261007/support-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await expect(page.getByText("Mensagem de ontem")).toBeVisible();
  await expect(page.getByText("Mensagem de amanhã")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Hoje", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("dashboard serves the existing green favicon", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const href = html.match(/rel="icon"[^>]*href="([^"]+)"/)?.[1];
  expect(href).toMatch(/^\/(?:src\/assets\/zyon-favicon-green|assets\/zyon-favicon-green-[\w-]+)\.png$/);
  expect(html).not.toContain('href="/zyon-mark.png"');
  const icon = await request.get(href!);
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/png");
  expect((await icon.body()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});
