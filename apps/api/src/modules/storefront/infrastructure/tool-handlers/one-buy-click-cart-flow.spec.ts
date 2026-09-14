import test from "node:test";
import assert from "node:assert/strict";
import { createCartHandlers, type CartHandlerDeps } from "./cart.handlers.js";

const cart = {
  sessionId: "conversation",
  discount: 0,
  freeShipping: false,
  items: [{ variantId: "variant", quantity: 1, unitPriceCents: 12000 }],
};

test("OneBuyClick prepares only its own checkout path and leaves the legacy path intact", async () => {
  const calls: unknown[] = [];
  const deps = {
    cartRepo: { getOrCreate: async () => cart },
    oneBuyClick: {
      prepareCheckout: async (input: unknown) => {
        calls.push(input);
        return { enabled: true, status: "ready_for_payment", shippingPreference: "fastest", paymentPreference: "pix", preparedActionId: "action" };
      },
    },
  } as unknown as CartHandlerDeps;

  const legacy = createCartHandlers(deps, { merchantId: "merchant", sessionId: "conversation" } as never);
  const legacyResult = await legacy.createCheckoutSession({ cartId: "conversation" });
  assert.match((legacyResult as any).checkoutUrl, /\/embed\/checkout\//);
  assert.equal(calls.length, 0);

  const fast = createCartHandlers(deps, {
    merchantId: "merchant",
    sessionId: "conversation",
    oneBuyClick: { enabled: true, shippingPreference: "fastest", paymentPreference: "pix" },
  } as never);
  const fastResult = await fast.createCheckoutSession({ cartId: "conversation" });
  assert.deepEqual(fastResult, {
    checkoutPrepared: true,
    actionId: "action",
    cartId: "conversation",
    shippingPreference: "fastest",
    paymentPreference: "pix",
  });
  assert.equal(calls.length, 1);
});

test("a product with multiple sellable variants requests a choice instead of using the first one", async () => {
  const product = {
    id: "shoe",
    name: "Tênis",
    type: "physical",
    variants: [
      { id: "shoe-41", sku: "shoe-41", isActive: true, basePriceInCents: 12000, media: [], attributes: { tamanho: "41" } },
      { id: "shoe-42", sku: "shoe-42", isActive: true, basePriceInCents: 12000, media: [], attributes: { tamanho: "42" } },
    ],
  };
  const handlers = createCartHandlers({
    prisma: { productVariant: {} },
    productRepo: {
      search: async () => ({ products: [product] }),
      findById: async (_merchantId: string, productId: string) => productId === "shoe" ? product : null,
    },
  } as unknown as CartHandlerDeps, { merchantId: "merchant", sessionId: "conversation" } as never);

  const result = await handlers.addItemToCart({ variantId: "shoe", quantity: 1 });

  assert.deepEqual(result, {
    error: "variant_selection_required",
    variantSelection: {
      productId: "shoe",
      productName: "Tênis",
      variants: [
        { id: "shoe-41", label: "41" },
        { id: "shoe-42", label: "42" },
      ],
    },
  });
});
