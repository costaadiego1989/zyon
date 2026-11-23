import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException, HttpException } from "@nestjs/common";
import { ProblemDetailsSchema } from "@zyon/contracts";
import { toProblemDetails } from "./problem-details.filter.js";

test("T40 public booking recovery", async t => {
  await t.test("only the known conflict exposes a typed review action and no private context", () => {
    const result = toProblemDetails(new ConflictException({ code: "service_hold_required", message: "Review the current appointment before continuing.",
      next_action: "review_checkout", nonce: "private", cart_fingerprint: "a".repeat(64), credential: "private", buyer: { globalUserId: "private" } }), "correlation");
    assert.equal(result.status, 409); assert.equal(result.code, "service_hold_required"); assert.equal(result.next_action, "review_checkout");
    assert.equal(ProblemDetailsSchema.parse(result).next_action, "review_checkout");
    assert.deepEqual(Object.keys(result).sort(), ["type", "title", "status", "code", "detail", "next_action", "correlation_id"].sort());
    assert.equal(JSON.stringify(result).includes("private"), false);
  });
  await t.test("another code cannot acquire the service action", () => {
    const result = toProblemDetails(new ConflictException({ code: "other_conflict", message: "Existing conflict", next_action: "review_checkout" }), "correlation");
    assert.equal(result.code, "other_conflict"); assert.equal(Object.hasOwn(result, "next_action"), false);
  });
  await t.test("another status cannot acquire the service action", () => {
    const result = toProblemDetails(new HttpException({ code: "service_hold_required", message: "Other status", next_action: "review_checkout" }, 500), "correlation");
    assert.equal(result.status, 500); assert.equal(Object.hasOwn(result, "next_action"), false);
  });
  await t.test("unknown actions and arbitrary exception metadata stay private", () => {
    const result = toProblemDetails(new ConflictException({ code: "service_hold_required", message: "Review", next_action: "pay_or_reacquire",
      hold: { generation: "private" } }), "correlation");
    assert.equal(Object.hasOwn(result, "next_action"), false); assert.equal(Object.hasOwn(result, "hold"), false);
  });
  await t.test("existing errors with no action keep the same public schema", () => {
    const result = toProblemDetails(new ConflictException("existing_conflict"), "correlation");
    assert.equal(result.code, "existing_conflict"); assert.equal(result.detail, "existing_conflict"); assert.equal(result.status, 409);
    assert.equal(Object.hasOwn(result, "next_action"), false); assert.deepEqual(ProblemDetailsSchema.parse(result), result);
  });
});
