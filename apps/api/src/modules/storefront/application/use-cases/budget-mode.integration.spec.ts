import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { PrismaMerchantRepository } from "../../../merchant/infrastructure/prisma-merchant.repository.js";
import { UpdateMerchantThemeUseCase } from "../../../merchant/application/update-merchant-theme.use-case.js";
import { CheckoutSettingsPublicController } from "../../../checkout-settings/presentation/http/checkout-settings.controller.js";
import { CreateBudgetRequestUseCase } from "./create-budget-request.use-case.js";
import { StorefrontController } from "../../presentation/http/storefront.controller.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { createCartHandlers } from "../../infrastructure/tool-handlers/cart.handlers.js";
import { buildStoreSystemPrompt } from "../../domain/prompts/store-system-prompt.builder.js";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { merchantThemeTokens, DEFAULT_MERCHANT_THEME } from "@zyon/shared-types";

function fixture() {
  let merchant: any = { id: "merchant", name: "Loja", budgetModeEnabled: false, storeSettings: { social: { instagram: "https://example.test/store" } }, users: [] };
  const budgets: any[] = [];
  const notifications: any[] = [];
  const prisma: any = {
    merchant: { findUnique: async ({ where }: any) => where.id === merchant.id ? merchant : null, update: async ({ data }: any) => (merchant = { ...merchant, ...data }) },
    merchantRule: { findUnique: async () => null },
    budgetRequest: { create: async ({ data }: any) => { const row = { ...data, id: "budget-1", createdAt: new Date() }; budgets.push(row); return row; } },
    merchantNotification: { create: async ({ data }: any) => { notifications.push(data); return data; } },
    $transaction: async (run: any) => run(prisma),
  };
  const repo = new PrismaMerchantRepository(prisma);
  return { prisma, repo, budgets, notifications, settings: new UpdateMerchantThemeUseCase(repo) };
}

test("budget settings survive reload, preserve other settings, and feed the public widget", async () => {
  const f = fixture();
  await f.settings.updateStoreSettings("merchant", { budget: { enabled: true, email: " contact@example.test ", whatsapp: "(11) 99999-9999" } });
  const saved = await f.settings.getStoreSettings("merchant");
  assert.deepEqual(saved.budget, { enabled: true, email: "contact@example.test", whatsapp: "11999999999" });
  assert.equal(saved.social?.instagram, "https://example.test/store");
  const publicConfig = new CheckoutSettingsPublicController({ execute: async () => ({ widgetBehavior: {}, triggerRules: [], suppressionRules: {}, handoff: {}, interventionPolicy: {} }) } as any, f.prisma);
  assert.equal((await publicConfig.getWidgetConfig("merchant")).budgetModeEnabled, true);
  await f.settings.updateStoreSettings("merchant", { budget: { enabled: false, email: "", whatsapp: "" } });
  assert.equal((await publicConfig.getWidgetConfig("merchant")).budgetModeEnabled, false);
  assert.equal((await f.settings.getStoreSettings("merchant")).budget?.email, "");
});

test("invalid budget settings never mutate merchant configuration", async () => {
  const f = fixture();
  for (const budget of [{ enabled: "yes" }, { enabled: true, email: "bad" }, { enabled: true, whatsapp: "123" }]) {
    await assert.rejects(() => f.settings.updateStoreSettings("merchant", { budget }), /invalid_budget/);
  }
  assert.equal((await f.repo.getProfile("merchant"))?.budgetModeEnabled, false);
});

test("quote submission uses the authorized server cart and persists buyer contact and an inbox notification", async () => {
  const f = fixture();
  await f.settings.updateStoreSettings("merchant", { budget: { enabled: true } });
  const capabilities = new RealtimeCapabilityService("local-test-secret-with-at-least-thirty-two-characters");
  const access = capabilities.issue({ purpose: "storefront-conversation", merchantId: "merchant", resourceId: "conversation" });
  const request = { headers: { authorization: `Bearer ${access.token}` } };
  let cleared = false;
  const cart = { total: 25000, discount: 1000, items: [{ variantId: "variant", name: "Produto", quantity: 2, unitPriceCents: 12500 }] };
  const controller = Object.assign(Object.create(StorefrontController.prototype), {
    capabilities, conversationRateLimiter: { consume: () => ({ allowed: true }) },
    cartRepo: { getOrCreate: async () => cart, clear: async () => { cleared = true; } },
    priceCart: async () => ({ cart }), createBudgetRequest: new CreateBudgetRequestUseCase(f.prisma),
  }) as StorefrontController;
  const body = { merchant_id: "merchant", cart_id: "conversation", customer_name: "Comprador", customer_email: "buyer@example.test", customer_phone: "11999999999", items: [{ variantId: "forged", productName: "Fake", quantity: 99, price: 0 }], total: 0, note: "Prazo de entrega?" };
  await assert.rejects(() => controller.handleCreateBudgetRequest(body, {}), /invalid_conversation_token/);
  await assert.rejects(() => controller.handleCreateBudgetRequest({ ...body, merchant_id: "foreign" }, request), /conversation_access_denied/);
  assert.equal(f.budgets.length, 0);
  const result = await controller.handleCreateBudgetRequest(body, request);
  assert.equal(result.total, 240);
  assert.equal(result.customerEmail, body.customer_email);
  assert.deepEqual(result.items, [{ variantId: "variant", productName: "Produto", quantity: 2, price: 125 }]);
  assert.equal(f.notifications[0].merchantId, "merchant");
  assert.equal(f.notifications[0].metadata.budgetId, result.id);
  assert.equal(cleared, true);
});

test("disabled mode and invalid contact reject requests without persisting a quote", async () => {
  const f = fixture();
  const useCase = new CreateBudgetRequestUseCase(f.prisma);
  const input = { merchantId: "merchant", customerName: "Comprador", customerEmail: "buyer@example.test", customerPhone: "11999999999", items: [{ variantId: "v", productName: "Produto", quantity: 1, price: 10 }], total: 10 };
  await assert.rejects(() => useCase.execute(input), /budget_mode_disabled/);
  await f.settings.updateStoreSettings("merchant", { budget: { enabled: true } });
  await assert.rejects(() => useCase.execute({ ...input, customerEmail: "invalid" }), /missing_required_fields/);
  await assert.rejects(() => useCase.execute({ ...input, items: [] }), /items_required/);
  assert.equal(f.budgets.length, 0);
});

test("quote mode prevents regular and OneBuyClick payment checkout", async () => {
  const f = fixture();
  await f.settings.updateStoreSettings("merchant", { budget: { enabled: true } });
  const handlers = createCartHandlers({ merchantRepo: f.repo, cartRepo: { getOrCreate: async () => ({ sessionId: "conversation", items: [{}] }) }, oneBuyClick: { prepareCheckout: () => assert.fail("must not prepare payment") } } as any,
    { merchantId: "merchant", sessionId: "conversation", oneBuyClick: { enabled: true, shippingPreference: "fastest", paymentPreference: "pix" } });
  assert.equal((await handlers.createCheckoutSession({ cartId: "conversation" }) as any).budgetRequired, true);
  const checkout = Object.assign(Object.create(StartCheckoutUseCase.prototype), { merchantRepository: f.repo, cartAuthority: { resolve: async () => ({}) } }) as StartCheckoutUseCase;
  await assert.rejects(() => checkout.execute({ merchant_id: "merchant", cart: {} } as any), /budget_mode_requires_request/);
  assert.match(buildStoreSystemPrompt({ storeSettings: { budget: { enabled: true } } }), /MODO ORÇAMENTO ATIVO/);
});

test("theme geometry supports zero radius and all widths, and grey differs from dark", () => {
  for (const [density, width] of [["compact", "480px"], ["comfortable", "680px"], ["spacious", "100%"]]) {
    const theme = merchantThemeTokens({ ...DEFAULT_MERCHANT_THEME, density, borderRadius: 0 });
    assert.equal(theme["--aacp-radius"], "0px");
    assert.equal(theme["--aacp-shell-max-width"], width);
  }
  assert.notEqual(merchantThemeTokens({ mode: "grey" })["--aacp-bg"], merchantThemeTokens({ mode: "dark" })["--aacp-bg"]);
  assert.equal(merchantThemeTokens({ ...DEFAULT_MERCHANT_THEME, mode: "dark", accentColor: "#123456" })["--aacp-accent"], "#123456");
});
