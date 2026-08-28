/**
 * Cross-sell E2E mock fixtures for widget_v2.
 * Intercepts API routes to return controlled responses.
 */
import type { Page } from "@playwright/test";

export interface MockProduct {
  sku: string;
  name: string;
  unit_price: number;
  image_url?: string;
  display_mode?: string;
}

export interface CrossSellMockConfig {
  /** Products returned in experience.suggestedProducts on /embed/start */
  startProducts?: MockProduct[];
  /** Products returned in experience.suggestedProducts on /embed/chat */
  chatProducts?: MockProduct[];
  /** Cart items pre-populated */
  cartItems?: Array<{ variantId: string; productName: string; quantity: number; price: number; subtotal: number }>;
  /** Override brand config */
  brand?: Record<string, unknown>;
  /** Chat message response text */
  chatMessage?: string;
  /** Arbitrary blocks returned on /embed/chat (e.g. payment_methods, shipping_options) */
  chatBlocks?: Array<{ type: string; data?: Record<string, unknown> }>;
  /** Whitelabel branding badge visibility (experience.rules.showBranding) */
  showBranding?: boolean;
}

const DEFAULT_CART = [
  { variantId: "SKU-001", productName: "Camiseta Zyon", quantity: 1, price: 89.9, subtotal: 89.9 },
];

const DEFAULT_BRAND = {
  name: "Zyon Store",
  accentColor: "#0f766e",
  backgroundColor: "#0a0a0a",
  textColor: "#fafafa",
  mode: "dark",
};

/**
 * Build the /embed/start response payload.
 */
function buildStartResponse(config: CrossSellMockConfig) {
  return {
    session_id: "chk_e2e_test_001",
    experience: {
      brand: { ...DEFAULT_BRAND, ...config.brand },
      agent: { name: "Zyon IA", greeting: "Olá! Vamos finalizar?" },
      buyer: { name: "Diego", email: "test@zyon.dev" },
      cart: { items: (config.cartItems ?? DEFAULT_CART).map((i) => ({ sku: i.variantId, name: i.productName, price: i.price, quantity: i.quantity })) },
      stage: "payment",
      stripeEnabled: true,
      suggestedProducts: config.startProducts,
      rules: config.showBranding !== undefined ? { showBranding: config.showBranding } : undefined,
    },
  };
}

/**
 * Build the /embed/chat response payload.
 */
function buildChatResponse(config: CrossSellMockConfig) {
  return {
    message: config.chatMessage ?? "Perfeito! Aqui estão as opções de pagamento.",
    blocks: config.chatBlocks ?? [],
    quick_replies: ["PIX", "Cartão de crédito"],
    experience: config.chatProducts?.length
      ? { suggestedProducts: config.chatProducts }
      : undefined,
    stage: config.chatBlocks?.some(b => b.type === "payment_methods") ? "payment" : undefined,
  };
}

/**
 * Build the /storefront/cart/:ref response payload.
 */
function buildCartResponse(config: CrossSellMockConfig) {
  const items = config.cartItems ?? DEFAULT_CART;
  return {
    items,
    total: items.reduce((sum, i) => sum + i.subtotal, 0),
  };
}

/**
 * Setup all API route mocks for cross-sell testing.
 * Call before navigating to the widget page.
 */
export async function setupCrossSellMocks(page: Page, config: CrossSellMockConfig = {}) {
  // /embed/start
  await page.route("**/embed/start", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildStartResponse(config)),
    });
  });

  // /embed/chat
  await page.route("**/embed/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildChatResponse(config)),
    });
  });

  // /storefront/cart/*
  await page.route("**/storefront/cart/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildCartResponse(config)),
    });
  });

  // /checkout-settings/widget-config
  await page.route("**/checkout-settings/widget-config**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabledTriggers: [],
        cooldownSeconds: 120,
        maxInterventionsPerSession: 3,
        advancedRules: [],
      }),
    });
  });
}

/**
 * Navigate to the widget with required query params.
 */
export async function navigateToCheckout(page: Page) {
  // Wait for network idle — first cold boot re-optimizes vite deps, so the page
  // may reload once before the module graph settles. `domcontentloaded` alone can
  // race that reload; `networkidle` ensures the app has actually mounted.
  await page.goto(
    "/?embedToken=tok_e2e&merchantId=mrc_e2e&cartRef=cart_e2e&apiBaseUrl=http://127.0.0.1:5174",
    { waitUntil: "domcontentloaded", timeout: 30_000 }
  );
}

/**
 * Wait for the widget to finish loading and show channel gate.
 */
export async function waitForChannelGate(page: Page) {
  await page.waitForSelector("[data-testid='channel-gate'], button:has-text('Chat'), button:has-text('chat')", { timeout: 10_000 });
}

/**
 * Select channel (click "Por chat" button) to enter active checkout.
 * Waits explicitly for the channel-gate chat button — no blind fallback that
 * could click the wrong button (e.g. "Voltar para o site") under parallel load.
 */
export async function selectChatChannel(page: Page) {
  const chatBtn = page.locator("button", { hasText: "Por chat" });
  await chatBtn.waitFor({ state: "visible", timeout: 15_000 });
  await chatBtn.click();
  // Wait for the chat thread to become active (welcome message rendered)
  await page.locator("text=/carrinho|Olá|produto ideal/i").first().waitFor({ state: "visible", timeout: 10_000 });
}

/** Standard test products for cross-sell */
export const CROSS_SELL_PRODUCTS: MockProduct[] = [
  { sku: "HOOD-001", name: "Hoodie Agentic", unit_price: 199.9, image_url: "https://placehold.co/80x80" },
  { sku: "CAP-001", name: "Boné Developer", unit_price: 59.9, image_url: "https://placehold.co/80x80" },
  { sku: "STICKER-001", name: "Sticker Pack", unit_price: 19.9 },
];
