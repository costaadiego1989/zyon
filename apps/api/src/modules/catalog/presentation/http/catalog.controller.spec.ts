import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StoreBuilderCatalogController } from "./catalog.controller.js";

describe("StoreBuilderCatalogController category reorder", () => {
  it("forwards the dashboard { items } payload unchanged to the use case", async () => {
    let received: unknown;
    const controller = { reorderCategories: { execute: async (_merchantId: string, payload: unknown) => { received = payload; } } };
    const payload = { items: [{ id: "cat_2", sort_order: 0 }] };

    const result = await StoreBuilderCatalogController.prototype.reorderCats.call(controller, "mrc_1", payload);

    assert.deepEqual(received, payload);
    assert.deepEqual(result, { reordered: true });
  });
});
