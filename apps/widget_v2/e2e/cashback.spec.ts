import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setupCrossSellMocks, navigateToCheckout, selectChatChannel } from "./fixtures/cross-sell-mocks";

const evidence = fileURLToPath(new URL("../../../.specs/features/cashback/evidence/", import.meta.url));
mkdirSync(evidence, { recursive: true });
const quote = (reservedCents = 0) => ({ merchantId: "mrc_e2e", sessionId: "chk_e2e_test_001", programActive: true, eligible: true,
  reason: null, availableCents: 3000 - reservedCents, maximumRedeemCents: 2000, reservedCents,
  estimatedEarnCents: (10000 - reservedCents) * .05, ruleVersion: 1, fingerprint: "cart-fingerprint", terms: "Crédito unificado para esta loja, no site e WhatsApp." });

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await setupCrossSellMocks(page, { cartItems: [{ variantId: "SKU-100", productName: "Produto de teste", price: 100, subtotal: 100, quantity: 1 }] });
  await page.route("**/embed/cashback/quote", route => route.fulfill({ json: quote() }));
  await navigateToCheckout(page); await selectChatChannel(page);
  if (width < 640) await page.getByRole("button", { name: "Abrir carrinho", exact: true }).click();
  await expect(page.getByRole("region", { name: "Cashback nesta compra" })).toBeVisible();
}

for (const width of [1440, 390]) {
  test(`CB-21 buyer applies and removes a partial cashback with explicit gestures at ${width}px (mocked API)`, async ({ page }) => {
    await open(page, width);
    const requests: unknown[] = [];
    await page.route("**/embed/cashback/reserve", async route => {
      const body = route.request().postDataJSON(); requests.push(body);
      expect(body.session_id).toBe("chk_e2e_test_001"); expect(body.amount_cents).toBe(1000);
      expect(body.idempotency_key).toBeTruthy(); expect(body.merchant_id).toBeUndefined(); expect(body.buyer_id).toBeUndefined();
      await route.fulfill({ json: quote(1000) });
    });
    await page.route("**/embed/cashback/remove", route => {
      requests.push(route.request().postDataJSON()); return route.fulfill({ json: quote() });
    });
    const panel = page.getByRole("region", { name: "Cashback nesta compra" });
    await panel.getByLabel("Valor de cashback a utilizar").fill("10.00");
    await panel.getByRole("button", { name: "Usar cashback", exact: true }).click();
    await expect(panel.getByText("Aplicado nesta compra", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
      const { useCheckoutStore } = await import("/src/store/checkout-store.ts" as string); return useCheckoutStore.getState().cart.cashbackCents;
    })).toBe(1000);
    await expect(panel.getByText(/4,50/)).toBeVisible();
    await expect(page.getByLabel("Carrinho do checkout").getByText("R$ 90,00", { exact: true })).toHaveCount(2);
    await page.screenshot({ path: `${evidence}/checkout-cashback-${width}.png`, fullPage: true, animations: "disabled" });
    await panel.getByRole("button", { name: "Remover cashback" }).click();
    await expect(panel.getByRole("button", { name: "Usar cashback" })).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
      const { useCheckoutStore } = await import("/src/store/checkout-store.ts" as string); return useCheckoutStore.getState().cart.cashbackCents;
    })).toBe(0);
    await expect(page.getByLabel("Carrinho do checkout").getByText("R$ 100,00", { exact: true })).toHaveCount(2);
    expect(requests).toHaveLength(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

test("CB-14 pending payments disable cashback changes (mocked API)", async ({ page }) => {
  await open(page, 1440);
  await page.getByRole("region", { name: "Cashback nesta compra" }).getByLabel("Valor de cashback a utilizar").fill("10");
  await page.evaluate(async () => {
    const { useCheckoutStore } = await import("/src/store/checkout-store.ts" as string);
    useCheckoutStore.setState({ paymentIntent: { intent_id: "pending-payment", method: "pix", status: "pending", amount_cents: 10000 }, paymentSubmitting: false });
  });
  await expect(page.getByRole("button", { name: "Usar cashback", exact: true })).toBeDisabled();
  await expect(page.getByText("O pagamento está em andamento. O cashback desta cobrança não pode ser alterado.")).toBeVisible();
});

test("CB-21 failed reservation preserves the total and retries the same command (mocked API)", async ({ page }) => {
  await open(page, 1440);
  const keys: string[] = [];
  await page.route("**/embed/cashback/reserve", route => {
    keys.push(route.request().postDataJSON().idempotency_key);
    return route.fulfill({ status: 503, json: { message: "cashback_unavailable" } });
  });
  const panel = page.getByRole("region", { name: "Cashback nesta compra" });
  await panel.getByRole("button", { name: "Usar cashback", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Não foi possível confirmar o cashback");
  await panel.getByRole("button", { name: "Usar cashback", exact: true }).click();
  await expect.poll(() => keys.length).toBe(2); expect(keys[0]).toBe(keys[1]);
  expect(await page.evaluate(async () => { const { useCheckoutStore } = await import("/src/store/checkout-store.ts" as string); return useCheckoutStore.getState().cart.cashbackCents ?? 0; })).toBe(0);
});

test("stacking origin changes at the same discount refresh cashback and use a new reservation command (mocked API)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setupCrossSellMocks(page, { cartItems: [{ variantId: "SKU-100", productName: "Produto de teste", price: 100, subtotal: 100, quantity: 1 }] });
  let sourceVersion = 1, quoteRequests = 0;
  const keys: string[] = [];
  const currentQuote = (reservedCents = 0) => ({ ...quote(reservedCents), fingerprint: `commercial-origin-${sourceVersion}`,
    estimatedEarnCents: (9500 - reservedCents) * .05, terms: sourceVersion === 1 ? "Cashback com cupom de R$ 5." : "Cashback com regra da loja de R$ 5." });
  await page.route("**/embed/start", route => route.fulfill({ json: { session_id: "chk_e2e_test_001", experience: {
    brand: { name: "Zyon Store", accentColor: "#0f766e", mode: "light" }, agent: { name: "Zyon IA", greeting: "Vamos revisar sua compra." },
    items: [{ sku: "SKU-100", name: "Produto de teste", unit_price: 100, quantity: 1 }],
    totals: { subtotal: 100, discount: 5, total: 95 }, stage: "payment", stripeEnabled: true,
    commercial_benefits_version: 1,
    commercial_nudge: { kind: "coupon", title: "Cupom aplicado", message: "Cupom de R$ 5 aplicado.", couponCode: "CUPOM5" },
  } } }));
  await page.route("**/embed/cashback/quote", route => { quoteRequests++; return route.fulfill({ json: currentQuote() }); });
  await page.route("**/embed/cashback/reserve", route => {
    const body = route.request().postDataJSON(); keys.push(body.idempotency_key); expect(body.amount_cents).toBe(1000);
    return sourceVersion === 1 ? route.fulfill({ status: 503, json: { message: "cashback_unavailable" } }) : route.fulfill({ json: currentQuote(1000) });
  });
  await page.route("**/embed/chat", route => {
    sourceVersion = 2;
    return route.fulfill({ json: { message: "A regra da loja substituiu o cupom. O desconto continua em R$ 5.", blocks: [], quick_replies: [],
      experience: { commercial_benefits_version: 2,
        commercial_nudge: { kind: "advanced_rule", title: "Regra da loja aplicada", message: "Desconto de R$ 5 pela regra da loja." } } } });
  });
  await navigateToCheckout(page); await selectChatChannel(page);
  const panel = page.getByRole("region", { name: "Cashback nesta compra" });
  await expect(panel.getByLabel("Valor de cashback a utilizar")).toBeVisible();
  await panel.getByLabel("Valor de cashback a utilizar").fill("10.00");
  await panel.getByRole("button", { name: "Usar cashback", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Não foi possível confirmar o cashback");
  const initialQuoteRequests = quoteRequests;
  const message = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await message.fill("Usar a regra da loja no lugar do cupom"); await message.press("Enter");
  await expect(page.getByText("A regra da loja substituiu o cupom. O desconto continua em R$ 5.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("discount-banner-text")).toHaveText("Desconto de R$ 5 pela regra da loja.");
  await expect(page.getByTestId("discount-banner-coupon")).toHaveCount(0);
  await expect.poll(() => quoteRequests).toBeGreaterThan(initialQuoteRequests);
  await expect.poll(() => page.evaluate(async () => {
    const { useCheckoutStore } = await import("/src/store/checkout-store.ts" as string);
    return { version: useCheckoutStore.getState().cart.commercialBenefitsVersion, discount: useCheckoutStore.getState().cart.discount };
  })).toEqual({ version: 2, discount: 5 });
  await panel.getByText("Condições do cashback", { exact: true }).click();
  await expect(panel.getByText("Cashback com regra da loja de R$ 5.", { exact: true })).toBeVisible();
  await panel.getByLabel("Valor de cashback a utilizar").fill("10.00");
  await panel.getByRole("button", { name: "Usar cashback", exact: true }).click();
  await expect(panel.getByText("Aplicado nesta compra", { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2); expect(keys[1]).not.toBe(keys[0]);
  await expect(page.getByLabel("Carrinho do checkout").getByText("R$ 85,00", { exact: true })).toHaveCount(2);
  const stackingEvidence = fileURLToPath(new URL("../../../.specs/features/cashback-stacking/evidence/", import.meta.url));
  mkdirSync(stackingEvidence, { recursive: true });
  await page.screenshot({ path: `${stackingEvidence}/widget-commercial-origin-revision.png`, fullPage: true, animations: "disabled" });
});
