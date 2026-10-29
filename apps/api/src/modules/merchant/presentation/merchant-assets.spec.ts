import test from "node:test";
import assert from "node:assert/strict";
import { MerchantController } from "./merchant.controller.js";

test("uploading an asset for a draft form preserves the saved merchant logo", async () => {
  const writes: any[] = [];
  const controller = Object.assign(Object.create(MerchantController.prototype), {
    s3: { isConfigured: () => true, uploadBase64: async (_data: string, prefix: string) => {
      assert.equal(prefix, "merchants/m1/logos");
      return { url: "https://cdn.example/asset.png" };
    } },
    updateTheme: { execute: async (...args: any[]) => writes.push(args) },
  }) as MerchantController;
  assert.deepEqual(await controller.uploadLogo("m1", { logo: "data:image/png;base64,AA==", persistTheme: false }), { logoUrl: "https://cdn.example/asset.png" });
  assert.equal(writes.length, 0);
  await controller.uploadLogo("m1", { logo: "data:image/png;base64,AA==" });
  assert.deepEqual(writes, [["m1", { logoUrl: "https://cdn.example/asset.png" }]]);
});
