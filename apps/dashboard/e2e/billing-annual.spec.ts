import { test, expect, type Page } from "@playwright/test";
import { BILLING_PLANS, billingOffer } from "@zyon/shared-types";
import { readFile } from "node:fs/promises";
import path from "node:path";
const catalog = (enabled = true) => Object.entries(BILLING_PLANS).map(([key, plan]) => ({
  plan_id: key, name: plan.name, monthly_price_brl: plan.monthlyPriceBrl, transaction_fee_cents: plan.transactionFeeCents,
  limits: plan.limits, features: plan.features, annual_checkout_available: enabled && key !== "starter",
  billing_options: [billingOffer(plan.monthlyPriceBrl * 100, "monthly"), ...(enabled && key !== "starter" ? [billingOffer(plan.monthlyPriceBrl * 100, "annual", 15)] : [])],
}));
async function mock(page: Page, enabled = true, paid = false) {
  let subscription: any = { plan: paid ? "growth" : "starter", status: paid ? "active" : "starter", current_period_end: "2030-10-01T00:00:00Z",
    trial_end: null, has_subscription: paid, has_billing_customer: paid, billing_provider: "stripe", billing_cycle: "monthly",
    billing_amount_cents: paid ? 44900 : 0, cancel_at_period_end: false, usage: { orders_current: 42, orders_limit: paid ? 500 : 100 } };
  const calls: any[] = [];
  await page.route("**/audit-api/**", async route => {
    const url = new URL(route.request().url()), body = route.request().postDataJSON();
    let data: unknown = {};
    if (url.pathname.endsWith("/billing/plans")) data = catalog(enabled);
    else if (url.pathname.endsWith("/billing/subscription/change")) {
      calls.push(body); subscription = { ...subscription, pending_plan: body.targetPlan, pending_billing_cycle: body.billingCycle, pending_billing_amount_cents: 457980, pending_effective_at: subscription.current_period_end }; data = subscription;
    } else if (url.pathname.endsWith("/billing/checkout-session")) { calls.push(body); data = { url: "http://localhost:5187/checkout-complete" }; }
    else if (url.pathname.endsWith("/billing/subscription")) data = subscription;
    await route.fulfill({ json: { data, meta: {} } });
  });
  await page.route("**/checkout-complete", route => route.fulfill({ body: "Pagamento de teste", contentType: "text/html" }));
  return calls;
}
test("signup preserves annual intent and sends full cycle selection to checkout", async ({ page }, info) => {
  const calls = await mock(page);
  await page.goto("/e2e/fixtures/billing-annual.html?view=signup&plan=growth&cycle=annual");
  await expect(page.getByRole("button", { name: /Anual/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".signup-plan__price")).toContainText("381,65");
  await expect(page.locator(".plan-selection__footer")).toContainText("4.579,80");
  await expect(page.locator(".signup-plan__fee").last()).toContainText("808,20");
  await expect(page.locator("body")).not.toContainText("sessões por mês");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("signup-annual.png"), fullPage: true });
  await page.locator(".signup-plan").screenshot({ path: info.outputPath("signup-annual-card.png") });
  await page.getByRole("button", { name: "Confirmar Growth no Stripe" }).click();
  await expect(page).toHaveURL(/checkout-complete/);
  expect(calls[0]).toMatchObject({ plan: "growth", billingCycle: "annual" });
});
test("disabled annual cannot silently submit a monthly checkout", async ({ page }) => {
  const calls = await mock(page, false);
  await page.goto("/e2e/fixtures/billing-annual.html?view=signup&plan=growth&cycle=annual");
  await expect(page.getByRole("button", { name: "Confirmar Growth no Stripe" })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("anual está indisponível");
  expect(calls).toHaveLength(0);
  await page.getByRole("button", { name: "Mensal", exact: true }).click();
  await expect(page.locator(".plan-selection__footer")).toContainText("449,00");
  await expect(page.getByRole("button", { name: "Confirmar Growth no Stripe" })).toBeEnabled();
});
test("current subscriber reviews annual change and sees scheduled total", async ({ page }, info) => {
  const calls = await mock(page, true, true);
  await page.goto("/e2e/fixtures/billing-annual.html");
  await page.getByRole("button", { name: /Anual/ }).click();
  const growthCard = page.locator(".billing-plans__plans-grid > div").filter({ has: page.getByRole("heading", { name: "Growth", exact: true }) });
  await growthCard.getByRole("button").click();
  await expect(page.getByRole("region", { name: "Revisar alteração" })).toContainText("4.579,80");
  expect(calls).toHaveLength(0);
  await page.getByRole("button", { name: "Confirmar alteração" }).click();
  await expect(page.getByText(/Alteração agendada:/)).toContainText("4.579,80");
  expect(calls).toEqual([{ targetPlan: "growth", billingCycle: "annual" }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("billing-scheduled.png"), fullPage: true });
});
test("public site uses API annual prices and simulates subscription plus fixed fees", async ({ page }, info) => {
  const webRoot = path.resolve("../web");
  await page.route("http://localhost:5187/marketing/**", async route => {
    const relative = new URL(route.request().url()).pathname.slice("/marketing/".length) || "index.html";
    const file = path.resolve(webRoot, relative);
    if (!file.startsWith(webRoot + path.sep)) return route.abort();
    const ext = path.extname(file);
    try { await route.fulfill({ body: await readFile(file), contentType: ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "application/octet-stream" }); }
    catch { await route.fulfill({ status: 404, body: "" }); }
  });
  await page.route("https://api.zyon-payments.com.br/billing/catalog", route => route.fulfill({ json: catalog() }));
  await page.goto("/marketing/index.html");
  await page.getByRole("button", { name: /Anual/ }).click();
  await expect(page.locator('[data-plan="growth"] .plan-annual')).toContainText("4.579,80");
  await expect(page.locator('[data-plan="growth"] a.button')).toHaveAttribute("href", /cycle=annual/);
  await page.locator("#billing-volume").fill("500");
  await page.locator("#billing-ticket").fill("100");
  await expect(page.locator("#billing-estimates tr").filter({ hasText: "Growth" })).toContainText("1.126,65");
  await expect(page.locator("#billing-estimates tr").filter({ hasText: "Free" })).toContainText("Acima do limite");
  await page.locator(".pricing-cycle").scrollIntoViewIfNeeded();
  await page.locator('[data-plan="growth"]').screenshot({ path: info.outputPath("public-growth-annual.png") });
  await page.locator(".pricing-simulator").screenshot({ path: info.outputPath("public-simulator.png") });
});
