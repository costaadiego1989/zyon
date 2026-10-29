import test from "node:test";
import assert from "node:assert/strict";
import { commercialNoticeSchema, commercialNoticesSchema } from "./commercial-notice.schemas.js";

const valid = { version: 1, code: "discount_limit_reached", message: "Aviso confirmado pelo servidor." };
test("commercial notice is strict versioned bounded and code-validated", () => {
  assert.deepEqual(commercialNoticeSchema.parse(valid), valid);
  for (const changed of [{ ...valid, version: 2 }, { ...valid, code: "invented" }, { ...valid, message: "" },
    { ...valid, message: " ", }, { ...valid, message: "x".repeat(1001) }, { ...valid, maximumPercent: 20 },
    { ...valid, cost: 123 }, { ...valid, claimToken: "PRIVATE" }]) assert.equal(commercialNoticeSchema.safeParse(changed).success, false);
});
test("commercial notice group rejects malformed members and oversized groups atomically", () => {
  assert.deepEqual(commercialNoticesSchema.parse([]), []);
  assert.deepEqual(commercialNoticesSchema.parse([valid]), [valid]);
  assert.equal(commercialNoticesSchema.safeParse([valid, { ...valid, code: "unknown" }]).success, false);
  assert.equal(commercialNoticesSchema.safeParse(Array.from({ length: 6 }, () => valid)).success, false);
});

