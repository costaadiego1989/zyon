import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertCartStock } from "./cart-stock-authority.js";

describe("native cart stock authority", () => {
  const row = (id: string, quantity: number, reserved = 0, type = "physical") => ({ id, sku: id, isActive: true, product: { merchantId: "merchant", isActive: true, deletedAt: null, type }, stock: [{ quantity, reserved }] });
  const database = (rows: unknown[]) => ({ productVariant: { findMany: async () => rows } }) as never;
  it("caps each variant independently and counts different option lines together", async () => {
    const prisma = database([row("red", 10), row("blue", 1)]);
    await assert.rejects(assertCartStock(prisma, "merchant", [{ sku: "blue", variantId: "blue", quantity: 2 }]), /cart_insufficient_stock/);
    await assert.rejects(assertCartStock(prisma, "merchant", [{ sku: "blue", variantId: "blue", quantity: 1 }, { sku: "blue", variantId: "blue", quantity: 1 }]), /cart_insufficient_stock/);
    await assertCartStock(prisma, "merchant", [{ sku: "red", variantId: "red", quantity: 3 }, { sku: "blue", variantId: "blue", quantity: 1 }]);
  });
  it("subtracts existing reservations and rejects removed native IDs", async () => {
    await assert.rejects(assertCartStock(database([row("red", 3, 2)]), "merchant", [{ sku: "red", variantId: "red", quantity: 2 }]), /cart_insufficient_stock/);
    await assert.rejects(assertCartStock(database([]), "merchant", [{ sku: "removed", variantId: "removed", quantity: 1 }]), /cart_product_unavailable/);
    await assert.rejects(assertCartStock(database([{ ...row("red", 3), isActive: false }]), "merchant", [{ sku: "red", variantId: "red", quantity: 1 }]), /cart_product_unavailable/);
  });
  it("skips physical balance only for digital/services and external-adapter compatibility lines", async () => {
    await assertCartStock(database([row("digital", 0, 0, "digital"), row("service", 0, 0, "service")]), "merchant", [{ sku: "digital", variantId: "digital", quantity: 1 }, { sku: "service", variantId: "service", quantity: 1 }]);
    await assertCartStock(database([]), "merchant", [{ sku: "external-adapter-sku", quantity: 1 }]);
  });
});
