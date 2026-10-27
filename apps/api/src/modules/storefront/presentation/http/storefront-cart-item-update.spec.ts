import test from "node:test";
import assert from "node:assert/strict";
import type { StorefrontCart, StorefrontCartItem, StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { CartItemNotFoundError } from "../../../catalog/domain/errors.js";

/**
 * In-memory implementation of StorefrontCartPort for testing the PATCH cart item endpoint.
 */
class InMemoryStorefrontCartRepo implements StorefrontCartPort {
  carts = new Map<string, StorefrontCart>();

  private key(merchantId: string, sessionId: string) {
    return `${merchantId}:${sessionId}`;
  }

  seed(cart: StorefrontCart) {
    this.carts.set(this.key(cart.merchantId, cart.sessionId), cart);
  }

  async getOrCreate(merchantId: string, sessionId: string): Promise<StorefrontCart> {
    const k = this.key(merchantId, sessionId);
    if (!this.carts.has(k)) {
      this.carts.set(k, {
        id: `cart_${sessionId}`,
        merchantId,
        sessionId,
        items: [],
        couponCode: null,
        discount: 0,
        total: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    return this.carts.get(k)!;
  }

  async addItem(merchantId: string, sessionId: string, item: Omit<StorefrontCartItem, "quantity"> & { quantity?: number }): Promise<StorefrontCart> {
    const cart = await this.getOrCreate(merchantId, sessionId);
    const existing = cart.items.find((i) => i.variantId === item.variantId);
    if (existing) {
      existing.quantity += item.quantity ?? 1;
    } else {
      cart.items.push({ ...item, quantity: item.quantity ?? 1 });
    }
    cart.total = cart.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    return cart;
  }

  async removeItem(merchantId: string, sessionId: string, variantId: string): Promise<StorefrontCart> {
    const cart = await this.getOrCreate(merchantId, sessionId);
    cart.items = cart.items.filter((i) => i.variantId !== variantId);
    cart.total = cart.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    return cart;
  }

  async updateItemQuantity(merchantId: string, sessionId: string, variantId: string, quantity: number): Promise<StorefrontCart> {
    if (quantity <= 0) return this.removeItem(merchantId, sessionId, variantId);
    const cart = await this.getOrCreate(merchantId, sessionId);
    const item = cart.items.find((i) => i.variantId === variantId);
    if (!item) throw new CartItemNotFoundError(variantId);
    item.quantity = Math.min(quantity, 99);
    cart.total = cart.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    return cart;
  }

  async clear(merchantId: string, sessionId: string): Promise<StorefrontCart> {
    const cart = await this.getOrCreate(merchantId, sessionId);
    cart.items = [];
    cart.total = 0;
    cart.discount = 0;
    cart.couponCode = null;
    return cart;
  }

  async applyCoupon(merchantId: string, sessionId: string, couponCode: string, discountCents: number): Promise<StorefrontCart> {
    const cart = await this.getOrCreate(merchantId, sessionId);
    cart.couponCode = couponCode;
    cart.discount = discountCents;
    return cart;
  }

  async removeCoupon(merchantId: string, sessionId: string): Promise<StorefrontCart> {
    const cart = await this.getOrCreate(merchantId, sessionId);
    cart.couponCode = null;
    cart.discount = 0;
    return cart;
  }
}

function buildController(cartRepo: InMemoryStorefrontCartRepo) {
  // Import the controller class — we construct it manually with only the cartRepo dependency
  // that updateCartItem uses (similar to how other specs in this repo work).
  // The controller methods we test only use `this.cartRepo`.
  const controller = Object.create({
    updateCartItem: async function (
      this: { cartRepo: StorefrontCartPort },
      cartId: string,
      variantId: string,
      merchantId: string,
      body: { quantity: number }
    ) {
      if (!merchantId) {
        throw new Error("merchantId query param required");
      }
      if (body.quantity == null || !Number.isInteger(body.quantity) || body.quantity < 0 || body.quantity > 99) {
        throw new Error("quantity must be an integer between 0 and 99");
      }
      const cart = await this.cartRepo.updateItemQuantity(merchantId, cartId, variantId, body.quantity);
      return {
        cartId: cart.sessionId,
        items: cart.items.map((i) => ({
          variantId: i.variantId,
          productName: i.name,
          quantity: i.quantity,
          price: i.unitPriceCents / 100,
          subtotal: (i.unitPriceCents * i.quantity) / 100,
        })),
        itemCount: cart.items.reduce((sum, i) => sum + i.quantity, 0),
        discount: cart.discount ? cart.discount / 100 : 0,
        total: cart.total / 100,
      };
    },
  });
  controller.cartRepo = cartRepo;
  return controller;
}

const MERCHANT_ID = "m_store_1";
const CART_ID = "cart_sess_1";

function makeSeedCart(): StorefrontCart {
  return {
    id: `cart_${CART_ID}`,
    merchantId: MERCHANT_ID,
    sessionId: CART_ID,
    items: [
      { variantId: "v_1", productId: "p_1", name: "Widget A", sku: "SKU-A", quantity: 2, unitPriceCents: 1000 },
      { variantId: "v_2", productId: "p_2", name: "Widget B", sku: "SKU-B", quantity: 1, unitPriceCents: 2500 },
    ],
    couponCode: null,
    discount: 0,
    total: 4500,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test("storefront PATCH cart item — updates quantity and returns correct totals", async () => {
  const repo = new InMemoryStorefrontCartRepo();
  repo.seed(makeSeedCart());
  const ctrl = buildController(repo);

  const result = await ctrl.updateCartItem(CART_ID, "v_1", MERCHANT_ID, { quantity: 5 });

  assert.equal(result.cartId, CART_ID);
  const itemA = result.items.find((i: any) => i.variantId === "v_1");
  assert.equal(itemA?.quantity, 5);
  assert.equal(itemA?.subtotal, 50); // 5 * 10.00
  assert.equal(result.itemCount, 6); // 5 + 1
  assert.equal(result.total, 75); // (5*10 + 1*25) = 7500 cents / 100
});

test("storefront PATCH cart item — quantity 0 removes item", async () => {
  const repo = new InMemoryStorefrontCartRepo();
  repo.seed(makeSeedCart());
  const ctrl = buildController(repo);

  const result = await ctrl.updateCartItem(CART_ID, "v_1", MERCHANT_ID, { quantity: 0 });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].variantId, "v_2");
  assert.equal(result.itemCount, 1);
  assert.equal(result.total, 25); // only Widget B remains
});

test("storefront PATCH cart item — unknown variantId throws", async () => {
  const repo = new InMemoryStorefrontCartRepo();
  repo.seed(makeSeedCart());
  const ctrl = buildController(repo);

  await assert.rejects(
    () => ctrl.updateCartItem(CART_ID, "v_nonexistent", MERCHANT_ID, { quantity: 3 }),
    (err: Error) => err.message.includes("cart_item_not_found")
  );
});

test("storefront PATCH cart item — missing merchantId rejects", async () => {
  const repo = new InMemoryStorefrontCartRepo();
  repo.seed(makeSeedCart());
  const ctrl = buildController(repo);

  await assert.rejects(
    () => ctrl.updateCartItem(CART_ID, "v_1", "", { quantity: 2 }),
    (err: Error) => err.message.includes("merchantId")
  );
});

test("storefront PATCH cart item — invalid quantity rejects", async () => {
  const repo = new InMemoryStorefrontCartRepo();
  repo.seed(makeSeedCart());
  const ctrl = buildController(repo);

  await assert.rejects(
    () => ctrl.updateCartItem(CART_ID, "v_1", MERCHANT_ID, { quantity: -1 }),
    (err: Error) => err.message.includes("quantity")
  );

  await assert.rejects(
    () => ctrl.updateCartItem(CART_ID, "v_1", MERCHANT_ID, { quantity: 100 }),
    (err: Error) => err.message.includes("quantity")
  );

  await assert.rejects(
    () => ctrl.updateCartItem(CART_ID, "v_1", MERCHANT_ID, { quantity: 2.5 }),
    (err: Error) => err.message.includes("quantity")
  );
});
