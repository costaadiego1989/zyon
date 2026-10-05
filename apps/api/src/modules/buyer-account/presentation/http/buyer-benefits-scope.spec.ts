import test from "node:test";
import assert from "node:assert/strict";
import { BuyerHubController } from "./buyer-hub.controller.js";

function controller() {
  const inputs: unknown[] = [];
  const uc = { execute: async (input: unknown) => { inputs.push(input); return { offers: [] }; } };
  return { inputs, c: new BuyerHubController(undefined as never, undefined as never, undefined as never,
    undefined as never, undefined as never, uc as never) };
}
test("normal buyer login can explicitly select a store, preserving authenticated identity", async () => {
  const { c, inputs } = controller();
  await c.getBenefits({ user: { globalUserId: "buyer", email: "buyer@example.invalid" } }, "store");
  assert.deepEqual(inputs, [{ globalUserId: "buyer", merchantId: "store" }]);
});
test("session-bound token cannot read a different store", async () => {
  const { c, inputs } = controller();
  await assert.rejects(c.getBenefits({ user: { globalUserId: "buyer", merchantId: "store" } }, "other"),
    (e: any) => e.getStatus() === 403 && e.message === "buyer_merchant_mismatch");
  assert.equal(inputs.length, 0);
});
test("bound token uses its tenant with or without the matching query", async () => {
  const { c, inputs } = controller();
  const req = { user: { globalUserId: "buyer", merchantId: "store" } };
  await c.getBenefits(req);
  await c.getBenefits(req, " store ");
  assert.deepEqual(inputs, Array(2).fill({ globalUserId: "buyer", merchantId: "store" }));
});
test("invalid or repeated tenant query is rejected before use-case execution", async () => {
  const { c, inputs } = controller();
  for (const value of ["", " ", "x".repeat(201), ["store", "other"], {}]) {
    await assert.rejects(c.getBenefits({ user: { globalUserId: "buyer" } }, value), (e: any) => e.getStatus() === 400);
  }
  assert.equal(inputs.length, 0);
});
test("legacy unscoped benefits do not invent an explicit tenant", async () => {
  const { c, inputs } = controller();
  await c.getBenefits({ user: { globalUserId: "buyer" } });
  assert.deepEqual(inputs, [{ globalUserId: "buyer", merchantId: undefined }]);
  await assert.rejects(c.getBenefits({}), (e: any) => e.getStatus() === 401);
});
