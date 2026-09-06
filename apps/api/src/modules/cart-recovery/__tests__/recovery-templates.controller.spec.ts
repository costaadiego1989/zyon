import test from "node:test";
import assert from "node:assert/strict";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { RecoveryTemplatesController } from "../presentation/http/recovery-templates.controller.js";

test("template routes require the merchant authentication guard", () => {
  assert.equal(Reflect.getMetadata(PATH_METADATA, RecoveryTemplatesController), "cart-recovery/templates");
  assert.ok(Reflect.getMetadata(GUARDS_METADATA, RecoveryTemplatesController).includes(AuthGuard));
});
test("read and save use authenticated tenant, not tenant fields supplied in body", async () => {
  const calls: unknown[][] = [];
  const lifecycle = {
    async get(merchantId: string) { calls.push(["get", merchantId]); return { effectiveChannel: "email" }; },
    async save(merchantId: string, body: unknown) { calls.push(["save", merchantId, body]); return { effectiveChannel: "email" }; },
  };
  const controller = new RecoveryTemplatesController(lifecycle as ConstructorParameters<typeof RecoveryTemplatesController>[0]);
  const request = { user: { merchantId: "merchant-a", userId: "owner-a", role: "owner" } };
  const body = { merchantId: "merchant-b", email: { subject: "Carrinho", body: "{{link}}" }, whatsapp: { body: "{{link}}", revision: 1 } };
  assert.deepEqual(await controller.get(request), { effectiveChannel: "email" });
  assert.deepEqual(await controller.save(request, body), { effectiveChannel: "email" });
  assert.deepEqual(calls, [["get", "merchant-a"], ["save", "merchant-a", body]]);
});
test("missing authenticated user cannot reach lifecycle operations", () => {
  let calls = 0;
  const lifecycle = { async get() { calls++; }, async save() { calls++; } };
  const controller = new RecoveryTemplatesController(lifecycle as unknown as ConstructorParameters<typeof RecoveryTemplatesController>[0]);
  assert.throws(() => controller.get({}), /missing_authenticated_user/);
  assert.throws(() => controller.save({}, {}), /missing_authenticated_user/);
  assert.equal(calls, 0);
});
