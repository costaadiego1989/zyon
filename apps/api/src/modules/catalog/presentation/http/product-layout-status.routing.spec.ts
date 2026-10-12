import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PATH_METADATA } from "@nestjs/common/constants.js";
import { StoreBuilderCatalogController } from "./catalog.controller.js";
import { ProductLayoutStatusController } from "./product-layout-status.controller.js";

test("HTTP layout-status reaches the summary controller before the generic product route", async () => {
  const require = createRequire(import.meta.url);
  const express = require("express");
  const app = express();
  const source = readFileSync(new URL("../../catalog.module.ts", import.meta.url), "utf8");
  const order = /controllers:\s*\[([^\]]+)\]/.exec(source)?.[1].split(",").map(value => value.trim());
  assert.ok(order, "use the real CatalogModule controller order");
  const calls: string[] = [];
  const summary = { entries: [{ productId: "product-a", blockCount: 2, enabledBlockCount: 1,
    faqCount: 3, testimonialCount: 0, videoCount: 1, lastUpdatedAt: "2026-09-29T00:00:00.000Z" }], total: 1 };
  const controllers = new Map<string, { type: Function; method: string; context: object }>([
    ["StoreBuilderCatalogController", { type: StoreBuilderCatalogController, method: "detail", context: { getProduct: { execute: async (_merchantId: string, productId: string) => {
      calls.push("product:" + productId);
      if (productId === "layout-status") throw Object.assign(new Error("product_not_found"), { status: 404 });
      return { id: productId };
    } } } }],
    ["ProductLayoutStatusController", { type: ProductLayoutStatusController, method: "listLayoutStatusRoute", context: { listLayoutStatus: { execute: async ({ merchantId }: { merchantId: string }) => {
      calls.push("summary:" + merchantId); return summary;
    } } } }],
  ]);
  for (const name of order) {
    const registration = controllers.get(name);
    if (!registration) continue;
    const handler = registration.type.prototype[registration.method];
    const route = "/v1/" + Reflect.getMetadata(PATH_METADATA, registration.type) + "/" + Reflect.getMetadata(PATH_METADATA, handler);
    app.get(route, async (req: any, res: any) => {
      try { res.json(await handler.call(registration.context, req.params.mid, req.params.pid)); }
      catch (error: any) { res.status(error.status || 500).json({ code: error.message }); }
    });
  }
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/v1/merchants/merchant-a/products/layout-status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), summary);
    assert.deepEqual(calls, ["summary:merchant-a"]);
    const product = await fetch(`http://127.0.0.1:${port}/v1/merchants/merchant-a/products/product-a`);
    assert.deepEqual(await product.json(), { id: "product-a" });
  } finally { await new Promise<void>(resolve => server.close(resolve)); }
});
