import { describe, expect, it } from "vitest";
import { persistVariantMedia } from "./persist-variant-media.js";
import { emptyVariant } from "../hooks/useVariantManager.js";
import { productEditorHash, productIdFromHash } from "./product-route.js";
import { validateProductMetadata, validateSimpleProduct } from "./product-validation.js";

describe("product editor persistence", () => {
  it("uploads creation media to actual variant IDs even when server order differs", async () => {
    const calls: string[] = [];
    const result = await persistVariantMedia([{ ...emptyVariant(), sku: "red", pendingImages: ["red-image"] }, { ...emptyVariant(), sku: "blue", pendingImages: ["blue-image"] }],
      [{ id: "blue-id", sku: "blue" }, { id: "red-id", sku: "red" }], async (id, image) => { calls.push(`${id}:${image}`); return { id: `media-${id}`, url: image }; });
    expect(calls).toEqual(["red-id:red-image", "blue-id:blue-image"]);
    expect(result.variants.map(v => v.id)).toEqual(["red-id", "blue-id"]); expect(result.failed).toBe(0);
  });
  it("keeps failed images and IDs, then retries only failed uploads", async () => {
    const saved = [{ id: "real-variant", sku: "SKU" }];
    const first = await persistVariantMedia([{ ...emptyVariant(), sku: "SKU", pendingImages: ["good", "bad"] }], saved,
      async (_id, image) => { if (image === "bad") throw Error("network"); return { id: "good-id", url: image }; });
    expect(first.failed).toBe(1); expect(first.variants[0].pendingImages).toEqual(["bad"]); expect(first.variants[0].id).toBe("real-variant");
    const calls: string[] = [];
    const retried = await persistVariantMedia(first.variants, saved, async (id, image) => { calls.push(`${id}:${image}`); return { id: "bad-id", url: image }; });
    expect(calls).toEqual(["real-variant:bad"]); expect(retried.failed).toBe(0);
  });
  it("preserves editor identity in a reloadable hash including encoded IDs", () => {
    expect(productIdFromHash(`#${productEditorHash("product/with space")}`)).toBe("product/with space");
    expect(productIdFromHash("#product-detail")).toBeNull(); expect(productIdFromHash("#catalog?productId=wrong")).toBeNull();
  });
  it("rejects invalid cost, fractional stock and unsafe download/service intervals", () => {
    const valid = { ...emptyVariant(), sku: "QA", basePriceInput: "19,47", stockInput: "2", costInput: "5,00" };
    expect(validateSimpleProduct(valid, "food")).toEqual({});
    expect(validateSimpleProduct({ ...valid, costInput: "-5" }, "food").simple_cost).toBeTruthy();
    expect(validateSimpleProduct({ ...valid, costInput: "abc" }, "food").simple_cost).toBeTruthy();
    expect(validateSimpleProduct({ ...valid, stockInput: "1.5" }, "food").simple_stock).toBeTruthy();
    expect(validateProductMetadata("digital", { downloadUrl: "http://example.invalid/file" }).downloadUrl).toBeTruthy();
    expect(validateProductMetadata("service", { startDate: "2026-10-06", startTime: "18:00", endDate: "2026-10-06", endTime: "17:00" }).serviceInterval).toBeTruthy();
  });
});
